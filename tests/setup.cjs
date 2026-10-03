// Load the browser modules into Node: they attach to window.FP and need only a few globals.
const path = require('node:path');

global.window = global;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.fetch = () => new Promise(() => {}); // never resolves: tests run on the offline heuristics

for (const f of ['syllables.js', 'sheet.js', 'structure.js', 'cadence.js', 'voice.js']) require(path.join(__dirname, '..', 'js', f));
window.FP.syl.online = false;

module.exports = window.FP;
