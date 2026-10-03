// Runs the end-to-end scenarios in a headless browser: npm run e2e [-- name filter]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, findBrowser } from './driver.mjs';
import scenarios from './scenarios.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..', '..');
const helpers = readFileSync(join(here, 'page-helpers.js'), 'utf8');
const filter = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!findBrowser()) { console.error('No Chrome, Chromium or Edge found — set CHROME_PATH'); process.exit(1); }

// the app, served by its own dev server on a free port
const port = 5300 + Math.floor(Math.random() * 600);
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const url = `http://localhost:${port}/`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) break; } catch { await sleep(100); } }

// a scenario's `async run() {…}` method → a function expression the page can call
const asFunction = (fn) => fn.toString().replace(/^async\s+(\w+)\s*\(/, 'async function $1(');

let failed = 0, skipped = 0, passed = 0;
for (const sc of scenarios.filter((s) => s.name.includes(filter))) {
  const t0 = Date.now();
  const page = await launch();
  try {
    await page.goto(url);
    // a fresh profile sets up its storage first; wait for the library to appear
    await page.eval(async () => { for (let i = 0; i < 80 && !document.querySelector('.row'); i++) await new Promise((r) => setTimeout(r, 100)); });
    await page.eval(helpers);
    let r = await page.eval(`(${asFunction(sc.run)})()`);
    if (sc.after && !(r && r.skipped)) {
      // the scenario reloaded the page (a second visit): carry on there
      await sleep(2000);
      await page.eval(helpers);
      r = { ...r, ...(await page.eval(`(${asFunction(sc.after)})()`)) };
    }
    if (r && r.skipped) { skipped++; console.log(`- skip  ${sc.name} (${r.skipped})`); continue; }
    if (process.env.E2E_VERBOSE) console.log(`  ${sc.name}:`, JSON.stringify(r));
    sc.check(r, assert);
    if (page.errors.length && !sc.allowErrors) throw new Error(`page errors:\n  ${page.errors.join('\n  ')}`);
    passed++;
    console.log(`✓ pass  ${sc.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`✗ FAIL  ${sc.name}\n${String(e.stack || e).split('\n').slice(0, 12).map((l) => `    ${l}`).join('\n')}`);
  } finally {
    await page.close();
  }
}
server.kill();
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
