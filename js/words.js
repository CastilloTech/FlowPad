/* FlowPad — rhyme suggestions and word associations.
 * Online: Datamuse (free, no key). Offline: a built-in word pool plus every word
 * you've written, matched by rhyme key; and curated theme lists.
 */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  const API = 'https://api.datamuse.com/words';
  const mem = new Map();

  const POOL = `flow glow go show know low slow throw grow snow blow though pro dough bro toe row crow owe below ago radio video tornado
day way say play stay pay weigh away today okay display replay decay betray relay spray gray pray stray
night light right fight might sight bright tight write height flight kite white bite quite ice twice nice price dice rice vice advice paradise
time rhyme crime climb prime dime mind grind find kind blind behind line fine mine shine sign design divine wine spine decline
fire higher liar buyer desire empire entire inspire wire tire retire
real feel deal steal heal meal wheel reveal appeal seal kneel still will kill skill thrill chill bill hill fill ill spill
money honey funny sunny
street beat heat feet meet seat sweet complete defeat repeat elite concrete retreat
dream team seem scheme beam stream supreme extreme
game fame name same flame shame claim frame aim blame came
pain rain chain gain brain train lane main plane remain insane vein champagne campaign
cash stash flash crash dash splash smash trash clash
gold hold cold told bold soul whole roll control goal role patrol console
king ring thing bring sing sting swing wing spring everything nothing something
love above glove dove shove
heart start part art apart smart chart dark mark spark park shark
lost cost boss toss cross gloss floss
city pity gritty witty pretty
hustle muscle struggle trouble double bubble rubble puzzle
stack track back black attack jack crack pack sack lack rap cap map gap trap slap snap clap
block clock lock rock stock shock knock top drop stop pop shop hop cop
war more floor door store four core pour score roar shore before explore
life knife wife strife
lie die cry sky fly high why try goodbye alive survive drive arrive thrive five
hood good could would should stood understood
town down crown frown around sound ground found bound pound round
pen ten men then again when friend end send spend bend trend blend defend
bless less mess press stress test best rest chest west quest guess success
fear near clear year here career appear sincere
truth youth proof roof
cool school pool rule fool tool jewel cruel
blue true through do who you crew view new few knew
moon soon tune noon spoon balloon
zone phone home alone stone throne bone grown known shown own
hate great late state wait weight gate fate plate straight
fast last past blast cast
loud proud cloud crowd allowed
voice choice noise boys toys
dollar holler collar scholar
paper later hater greater player
power hour tower shower flower
bars stars cars scars guitars
verse worse first thirst burst curse nurse purse
word bird heard third nerd absurd
world girl curl pearl swirl
hurt dirt shirt alert
earth worth birth
learn burn turn earn return
free me see be we three tree key agree degree sea
hands stands plans fans bands lands
mic bike like strike hype type`.split(/\s+/);

  const THEMES = {
    money: 'cash bread paper stacks bands racks rich wealth bank dollars green profit gold hustle grind invest riches commas vault safe',
    love: 'heart passion devotion romance kiss trust soul forever desire embrace loyalty angel crush feelings flame promise',
    street: 'block corner city concrete hood alley pavement sirens hustle curb avenue traffic graffiti streetlights project',
    grind: 'hustle work sweat focus pressure climb goals discipline ambition drive patience sacrifice overtime vision',
    night: 'moon stars dark shadows midnight neon dreams silence black insomnia city lights late',
    pain: 'scars tears hurt broken storm wounds rain struggle loss ache darkness heavy bleed healing',
    victory: 'crown throne champion trophy glory win king top legend triumph gold fame podium',
    fire: 'flame heat burn smoke blaze ashes spark lit inferno ember torch wildfire',
    time: 'clock hours seconds past future legacy moment forever history now hourglass',
    ocean: 'waves tide deep current salt shore drown blue sail storm horizon',
    family: 'mama blood home brother sister roots legacy kin protect pops grandma',
    freedom: 'chains wings sky escape open road liberty break loose fly',
  };

  function online() { return FP.syl.online && navigator.onLine !== false; }

  function dm(params) {
    const qs = new URLSearchParams(params).toString();
    if (mem.has(qs)) return mem.get(qs);
    if (!online()) return Promise.reject(new Error('offline'));
    const p = fetch(`${API}?${qs}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
    mem.set(qs, p);
    p.catch(() => mem.delete(qs));
    return p;
  }

  const good = (w) => /^[a-z][a-z' -]*$/i.test(w);
  const shape = (arr, exclude) =>
    arr.filter((r) => good(r.word) && r.word !== exclude)
      .map((r) => ({ word: r.word, n: r.numSyllables || FP.syl.count(r.word) }));

  let corpus = () => '';
  const keyCache = new Map();
  const keyOf = (w) => { let k = keyCache.get(w); if (k == null) { k = FP.syl.rhymeKey(w); keyCache.set(w, k); } return k; };
  window.addEventListener('fp:lexicon', () => keyCache.clear());

  function offlineRhymes(word, kind) {
    const w = FP.syl.clean(word);
    const mine = (corpus().toLowerCase().replace(/’/g, "'").match(/[a-z']{2,}/g) || []).map(FP.syl.clean);
    const cands = [...new Set([...POOL, ...mine])].filter((c) => c && c !== w);
    const k = keyOf(w);
    const v = FP.syl.vowelKey(w);
    let list;
    if (kind === 'perfect') list = cands.filter((c) => keyOf(c) === k);
    else if (kind === 'near') list = cands.filter((c) => keyOf(c) !== k && FP.syl.vowelKey(c) === v);
    else list = cands.filter((c) => c.slice(-2) === w.slice(-2) || (c[0] === w[0] && keyOf(c) === k));
    return list.slice(0, 80).map((c) => ({ word: c, n: FP.syl.count(c) }));
  }

  async function rhymes(word, kind = 'perfect') {
    const w = FP.syl.clean(word);
    if (!w) return { list: [], source: 'none' };
    const key = { perfect: 'rel_rhy', near: 'rel_nry', sound: 'sl' }[kind] || 'rel_rhy';
    try {
      const res = await dm({ [key]: w, md: 's', max: 150 });
      const list = shape(res, w);
      if (list.length) return { list, source: 'online' };
    } catch (e) { /* fall through to offline */ }
    return { list: offlineRhymes(w, kind), source: 'offline' };
  }

  async function associate(seed) {
    const s = String(seed).trim().toLowerCase();
    if (!s) return { groups: [], source: 'none' };
    try {
      const [trg, ml, adj, nouns] = await Promise.all([
        dm({ rel_trg: s, md: 's', max: 40 }),
        dm({ ml: s, md: 's', max: 40 }),
        dm({ rel_jjb: s, md: 's', max: 24 }),
        dm({ rel_jja: s, md: 's', max: 24 }),
      ]);
      const groups = [
        { title: 'Associated', list: shape(trg, s) },
        { title: 'Similar meaning', list: shape(ml, s) },
        { title: 'Describing words', list: shape(adj, s) },
        { title: 'Things it describes', list: shape(nouns, s) },
      ].filter((g) => g.list.length);
      if (groups.length) return { groups, source: 'online' };
    } catch (e) { /* offline */ }
    const hit = THEMES[s] ? s : Object.keys(THEMES).find((t) => THEMES[t].split(' ').includes(s));
    const groups = hit ? [{ title: `Theme · ${hit}`, list: THEMES[hit].split(' ').filter((x) => x !== s).map((x) => ({ word: x, n: FP.syl.count(x) })) }] : [];
    return { groups, source: 'offline' };
  }

  FP.words = {
    rhymes,
    associate,
    themes: Object.keys(THEMES),
    setCorpus(fn) { corpus = fn; },
  };
})();
