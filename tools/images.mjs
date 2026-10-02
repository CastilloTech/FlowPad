// Renders the store / share images with the e2e browser: node tools/images.mjs
//   icons/og.png            link-preview card (tools/og.html), 1200×630
//   icons/screens/*.png     app screenshots for the install dialog (manifest "screenshots"), 780×1688
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch } from '../tests/e2e/driver.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const card = await launch({ width: 1200, height: 630, scale: 1, mobile: false });
await card.goto(pathToFileURL(resolve('tools/og.html')).href);
writeFileSync('icons/og.png', await card.screenshot());
await card.close();
console.log('icons/og.png');

const port = 5300 + Math.floor(Math.random() * 600);
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(700);
mkdirSync('icons/screens', { recursive: true });
const shots = {
  write: async () => {},
  rhymes: async (p) => p.eval(async () => {
    const b = document.querySelectorAll('.blk.bar')[1];
    b.querySelectorAll('.cell')[15].click();
    document.querySelector('#cin').blur();
    [...document.querySelectorAll('.dk-p')].find((x) => /Rhymes/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 1500));
  }),
  beat: async (p) => p.eval(async () => {
    [...document.querySelectorAll('.dk-p')].find((x) => /Beat/.test(x.textContent)).click();
    await new Promise((r) => setTimeout(r, 600));
  }),
};
for (const [name, act] of Object.entries(shots)) {
  const p = await launch();
  await p.goto(`http://localhost:${port}/`);
  await p.eval(async () => { document.querySelector('.row').click(); await new Promise((r) => setTimeout(r, 800)); window.scrollTo(0, 0); });
  await act(p);
  await sleep(300);
  writeFileSync(`icons/screens/${name}.png`, await p.screenshot());
  await p.close();
  console.log(`icons/screens/${name}.png`);
}
server.kill();
