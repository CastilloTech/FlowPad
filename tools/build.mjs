// Builds the published site into _site/: the app files as they are, with JS and CSS minified by
// esbuild (fetched by npx — the app itself stays dependency-free and build-free to work on).
// Top-level names are kept as-is, which the app's scripts rely on to share one global scope.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = '_site';
const SITE = ['index.html', 'privacy.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'CNAME', 'icons', 'css', 'js'];

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const size = (files) => files.reduce((a, f) => a + statSync(f).size, 0);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const p of SITE) if (existsSync(p)) cpSync(p, join(OUT, p), { recursive: true });

const code = walk(OUT).filter((f) => /\.(js|css)$/.test(f));
const before = size(code);
execFileSync('npx', ['--yes', 'esbuild@0.24.0', ...code, '--minify', `--outdir=${OUT}`, `--outbase=${OUT}`, '--allow-overwrite', '--log-level=warning'], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
const after = size(code);
console.log(`Built ${OUT}/ — JS + CSS ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (${Math.round((1 - after / before) * 100)}% smaller)`);
