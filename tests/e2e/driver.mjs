// A tiny headless-browser driver over the Chrome DevTools Protocol — no dependencies.
// Finds Chrome / Chromium / Edge (or $CHROME_PATH), opens a fresh profile, emulates a phone,
// and evaluates code in the page. Uncaught page errors are collected so tests can fail on them.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export const findBrowser = () => CANDIDATES.find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 390, height = 844, scale = 2, mobile = true } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome, Chromium or Edge found — set CHROME_PATH');
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), 'flowpad-e2e-'));
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 80 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(150); }
  }
  if (!targets) { proc.kill(); throw new Error('Browser did not start'); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  return {
    errors,
    async goto(url) { await send('Page.enable'); await send('Page.navigate', { url }); await sleep(1500); },
    /** Evaluate an expression (or a function's source called with no arguments) and return its value. */
    async eval(code) {
      const expression = typeof code === 'function' ? `(${code})()` : code;
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text);
      return m.result?.result?.value;
    },
    /** PNG of the viewport. */
    async screenshot() { const m = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(m.result.data, 'base64'); },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill('SIGKILL');
      await sleep(400);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
    },
  };
}
