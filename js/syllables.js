/* FlowPad — syllable counting, syllable splitting, stress and rhyme keys.
 *
 * Works fully offline with heuristics. When online, words are looked up in the
 * CMU-based Datamuse dictionary in the background (pronunciation with stress
 * marks) and cached on the device, which makes counts and stresses exact.
 */
(() => {
  'use strict';
  const FP = (window.FP = window.FP || {});
  const LEX_KEY = 'fp.lex.v1';
  const API = 'https://api.datamuse.com/words';

  // word -> ARPAbet phones ("M EH1 M ER0 IY0") or '' when the dictionary has no entry
  let lex = {};
  try { lex = JSON.parse(localStorage.getItem(LEX_KEY) || '{}'); } catch (e) { lex = {}; }

  const infoCache = new Map();

  // ---------- heuristics ----------

  const EXC = {
    every: 2, everything: 3, everyone: 3, everybody: 4, everywhere: 3, people: 2, hundred: 2,
    hundreds: 2, recipe: 3, idea: 3, ideas: 3, being: 2, going: 2, doing: 2, seeing: 2, saying: 2,
    playing: 2, poem: 2, poet: 2, quiet: 2, science: 2, society: 4, area: 3, create: 2,
    created: 3, lion: 2, fire: 1, fires: 1, hour: 1, hours: 1, our: 1, flower: 2, power: 2,
    powers: 2, tower: 2, shower: 2, business: 2, family: 3, camera: 3, chocolate: 3,
    interest: 3, evening: 2, naive: 2, beautiful: 3, cruel: 2, fuel: 2, jewel: 2, jewels: 2,
    ruin: 2, diary: 3, violent: 3, diamond: 2, diamonds: 2, maybe: 2, forever: 3, somewhere: 2,
    someone: 2, sometimes: 2, something: 2, anyone: 3, whatever: 3, whenever: 3, somebody: 3,
    nobody: 3, anybody: 4, into: 2, onto: 2, microphone: 3, video: 3, radio: 3, stereo: 3,
    yeah: 1, gonna: 2, wanna: 2, gotta: 2, "ain't": 1, "i'm": 1, "i'ma": 2, imma: 2, are: 1,
    were: 1, there: 1, where: 1, here: 1, whose: 1, one: 1, once: 1, eyes: 1, lie: 1, lies: 1,
    die: 1, dies: 1, tried: 1, cried: 1, shoes: 1, goes: 1, does: 1, clothes: 1, ones: 1,
    above: 2, alive: 2, poetry: 3, children: 2, eleven: 3, prayer: 1, prayers: 1, player: 2,
    players: 2, layer: 2, iron: 2, desire: 3, real: 1, really: 2, idol: 2, dial: 2, trial: 2,
    denial: 3, riot: 2, giant: 2, client: 2, rhythm: 2, rhythms: 2, prism: 2,
    chasm: 2, heaven: 2, seven: 2, wednesday: 2, different: 3, favorite: 3, several: 3,
    evil: 2, eyeing: 2, flying: 2, dying: 2, lying: 2, crying: 2, buying: 2, trying: 2,
    toward: 1, towards: 1, cause: 1, "'cause": 1, cuz: 1, 'y\'all': 1, yall: 1,
  };

  // Words that are usually unstressed in running speech.
  const FUNC = new Set(('a an the and but or nor so yet if of to in on at by for from with as ' +
    'is am are was were be been its it my your our their his her him them me us we you i he she ' +
    'they this that than then do does did have has had can could would should will shall may ' +
    'might must just im ima youre theyre were thats its dont aint gon na ta to').split(' '));

  const clean = (w) => String(w).toLowerCase().replace(/’/g, "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');

  function heurCount(raw) {
    const word = clean(raw);
    if (!word) return 0;
    if (EXC[word] != null) return EXC[word];
    const w = word.replace(/'/g, '');
    if (EXC[w] != null) return EXC[w];
    if (w.length <= 3) return 1;
    const s = w.replace(/^y/, '');
    let n = (s.match(/[aeiouy]+/g) || []).length;
    // silent final e (make, while) — but "table", "little" keep it
    if (/[^aeiouy]e$/.test(s) && !/[^aeiouy]le$/.test(s)) n--;
    // -es: silent unless after s, x, z, ch, sh, ce, ge (boxes, places)
    if (/[^aeiouy]es$/.test(s) && !/([sxzcg]|ch|sh)es$/.test(s) && !/[^aeiouy]les$/.test(s)) n--;
    // -ed: silent unless after t or d (wanted, needed)
    if (/[^aeiouy]ed$/.test(s) && !/[td]ed$/.test(s)) n--;
    // silent e before common suffixes (lonely, homeless, statement)
    if (/[^aeiouy]e(ly|ment|ments|ful|less|ness)$/.test(s)) n--;
    // hiatus: li-on, pi-a-no, ac-tu-al (but not -tion, -cial)
    n += (s.match(/[^tscgxq]i[aou]/g) || []).length;
    n += (s.match(/[^qg]u[ao]/g) || []).length;
    if (/[^aeiou]ism$/.test(s)) n++;
    return Math.max(1, n);
  }

  const NEUTRAL = ['ings', 'ing', 'ers', 'er', 'est', 'ness', 'ments', 'ment', 'fully', 'ful', 'less', 'ly', 'ed', 'es', 's'];
  const PREFIX = /^(a(?=[^aeiouy][aeiouy])|be(?=[^aeiouy][aeiouy])|de(?=[^aeiouy][aeiouy])|re(?=[^aeiouy])|pre(?=[^aeiouys])|un(?=[^aeiouyd])|dis|mis|ex(?=[^aeiouyt])|con(?=[^aeiouyn])|com(?=[^aeiouym])|en(?=[^aeiouyt])|em(?=[^aeiouy])|for(?=[bgs])|with|sur)/;
  const PRIM = { hotel: 1, guitar: 1, police: 1, forget: 1, forgive: 1, today: 1, tonight: 1, tomorrow: 1, hello: 1, okay: 1, cement: 1, career: 1, machine: 1, alone: 1, afraid: 1, around: 1, about: 1, because: 1, believe: 1, before: 1, between: 1, beyond: 1, myself: 1, yourself: 1, himself: 1, herself: 1, itself: 1, ourselves: 2, themselves: 1, maybe: 0, money: 0, microphone: 0, everybody: 0, everything: 0, everyone: 0, anybody: 0, somebody: 0, nobody: 0, celebrate: 0, underground: 2, understand: 2, entertain: 2, disappear: 2, volunteer: 2 };

  function primary(w, n) {
    if (n <= 1) return 0;
    if (PRIM[w] != null) return Math.min(PRIM[w], n - 1);
    for (const suf of NEUTRAL) {
      if (w.endsWith(suf) && w.length - suf.length >= 3) {
        const root = w.slice(0, -suf.length);
        const rn = heurCount(root);
        if (rn >= 1 && rn < n) return Math.min(primary(root, rn), n - 1);
      }
    }
    if (/(tion|sion|cian|cial|tial|cious|tious|gious|ic|ics|ish)$/.test(w)) return Math.max(0, n - 2);
    if (/(ity|ety|ical|ious|ian|ial|ogy|graphy|ify|ual)$/.test(w)) return Math.max(0, n - 3);
    if (/(ee|eer|ese|ique|esque|oon|ette)$/.test(w)) return n - 1;
    if (n === 2 && PREFIX.test(w)) return 1;
    if (n <= 3) return 0;
    return n - 3;
  }

  function heurStress(word, n) {
    const w = clean(word).replace(/'/g, '');
    const out = new Array(n).fill(0);
    if (!n) return out;
    if (n === 1) { out[0] = FUNC.has(w) ? 0 : 1; return out; }
    const p = primary(w, n);
    out[p] = 1;
    if (n >= 4 && p >= 2) out[p - 2] = 2;
    return out;
  }

  // ---------- splitting a word into displayable syllables ----------

  function adjust(pieces, n) {
    pieces = pieces.filter((p) => p !== '');
    if (!pieces.length) pieces = [''];
    while (pieces.length > n && pieces.length > 1) {
      let best = 0, bl = Infinity;
      for (let i = 0; i < pieces.length - 1; i++) {
        const l = pieces[i].length + pieces[i + 1].length;
        if (l < bl) { bl = l; best = i; }
      }
      pieces.splice(best, 2, pieces[best] + pieces[best + 1]);
    }
    while (pieces.length < n) {
      let bi = -1, bl = 1;
      pieces.forEach((p, i) => { if (p.length > bl) { bl = p.length; bi = i; } });
      if (bi < 0) break;
      const p = pieces[bi];
      const m = Math.ceil(p.length / 2);
      pieces.splice(bi, 1, p.slice(0, m), p.slice(m));
    }
    while (pieces.length < n) pieces.push('');
    return pieces;
  }

  const BLENDS = ['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'th', 'sh', 'ch', 'ph', 'wh', 'wr'];
  const SPLIT = { every: ['ev', 'ery'], every3: ['ev', 'er', 'y'], different: ['dif', 'fer', 'ent'], favorite: ['fa', 'vor', 'ite'], business: ['bus', 'i', 'ness'] };
  const COMPOUND = /^(every|some|any|no|your|my|him|her|them|it|our)(body|one|thing|where|times?|how|self|selves)$/;
  const hasV = (s) => /[aeiouy]/.test(s);

  /** Split at a known boundary: `cut` characters go to the head, the tail gets `nt` syllables. */
  function splitAt(word, cut, nt, n) {
    const nh = n - nt;
    if (nh < 1 || nt < 1) return null;
    return [...splitWord(word.slice(0, cut), nh), ...splitWord(word.slice(cut), nt)];
  }

  function splitWord(word, n) {
    if (n <= 1) return [word];
    const lw = word.toLowerCase();
    const bare = lw.replace(/[^a-z]/g, '');

    // Fixed spellings, then compounds (some-thing, ev-ery-one) and suffixes (count-ed, run-ning, dark-ness).
    const fixed = SPLIT[bare + (bare === 'every' && n === 3 ? '3' : '')];
    if (fixed && fixed.length === n && bare === lw) {
      let at = 0;
      return fixed.map((p) => word.slice(at, (at += p.length)));
    }
    const cm = bare === lw && lw.match(COMPOUND);
    if (cm) {
      const r = splitAt(word, cm[1].length, heurCount(cm[2]), n);
      if (r) return adjust(r, n);
    }
    let sm = lw.match(/^([a-z']*[aeiouy][a-z']*?)(ings?|ness|ments?|less|ful)$/) || lw.match(/^([a-z']*[aeiouy][a-z]*?[td])(ed)$/);
    // -ly, except where "pl"/"bl" belong together (sup-ply, re-ply, hum-bly)
    if (!sm && /[^bcfp]ly$/.test(lw) && hasV(lw.slice(0, -2))) sm = [lw, lw.slice(0, -2), 'ly'];
    if (sm) {
      let cut = sm[1].length;
      // a doubled consonant splits between its pair (run-ning, admit-ted) — but not ss/ll/ff/zz (miss-ing, call-ing)
      if (/^(ing|ed)/.test(sm[2]) && /([^aeiouyslfz])\1$/.test(sm[1])) cut--;
      const r = splitAt(word, cut, 1, n);
      if (r) return adjust(r, n);
    }

    const isV = (i) => {
      const c = lw[i];
      if ('aeiou'.includes(c)) return true;
      if (c === 'y') return i > 0 && !'aeiou'.includes(lw[i + 1] || 'x');
      return false;
    };
    const groups = [];
    for (let i = 0; i < lw.length;) {
      if (isV(i)) {
        let j = i;
        while (j + 1 < lw.length && isV(j + 1)) j++;
        groups.push([i, j]);
        i = j + 1;
      } else i++;
    }
    if (groups.length > 1) {
      const g = groups[groups.length - 1];
      const tail = lw.slice(g[0]).replace(/'/g, '');
      const keep = /[^aeiouy]les?$/.test(lw) || /[td]ed$/.test(lw) || /([sxz]|ch|sh|ce|ge)es$/.test(lw);
      if (g[0] === g[1] && /^e[sd]?$/.test(tail) && !keep) groups.pop();
    }
    if (groups.length < 2) return adjust([word], n);
    // consonant + "le" makes the last syllable: sin-gle, lit-tle, ta-ble, syl-la-ble (but tick-le)
    const cle = lw.match(/[^aeiouy](le[sd]?)$/);
    const lastE = groups[groups.length - 1];
    const cleCut = cle && lastE[0] === lastE[1] && lastE[0] === lw.length - cle[1].length + 1
      ? (lw.slice(cle.index - 1, cle.index + 1) === 'ck' ? cle.index + 1 : cle.index) : -1;
    const cuts = [];
    for (let g = 0; g < groups.length - 1; g++) {
      const a = groups[g][1] + 1;
      const b = groups[g + 1][0];
      const cl = lw.slice(a, b);
      let cut;
      if (g === groups.length - 2 && cleCut >= a) cut = cleCut;
      else if (cl.length <= 1) cut = cl === 'x' ? b : a;
      else if (/^(ck|ng)/.test(cl)) cut = a + 2 > b ? b : a + 2;
      else if (cl.length === 2) cut = BLENDS.includes(cl) && cl !== 'wr' ? a : a + 1;
      else cut = BLENDS.includes(cl.slice(-2)) ? b - 2 : a + 1;
      cuts.push(Math.min(Math.max(cut, a), b));
    }
    const pieces = [];
    let last = 0;
    for (const c of cuts) { pieces.push(word.slice(last, c)); last = c; }
    pieces.push(word.slice(last));
    return adjust(pieces, n);
  }

  // ---------- numbers ----------

  const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
    if (n < 10000) {
      if (n % 1000 === 0) return ONES[n / 1000] + ' thousand';
      const hi = Math.floor(n / 100), lo = n % 100;
      if (hi % 10 !== 0) return numWords(hi) + ' ' + (lo ? (lo < 10 ? 'oh ' + ONES[lo] : numWords(lo)) : 'hundred');
      return numWords(Math.floor(n / 1000)) + ' thousand ' + numWords(n % 1000);
    }
    return String(n).split('').map((d) => ONES[+d]).join(' ');
  }

  // ---------- dictionary lookups (Datamuse), queued & cached ----------

  const pending = new Set();
  const inflight = new Set();
  let busy = 0;
  let flushTimer = null;
  let notifyTimer = null;
  let corpus = () => '';

  /** Vowel sounds of a dictionary word, one per syllable (ARPAbet: "EH", "AY" …). */
  function lexVowels(w) {
    const ph = lex[w];
    return ph ? ph.split(' ').filter((p) => /\d$/.test(p)).map((p) => p.replace(/\d$/, '')) : null;
  }

  // common one-syllable words spelled unlike they sound
  const VOWEL_EXC = {
    one: 'AH', two: 'UW', to: 'UW', too: 'UW', do: 'UW', you: 'UW', who: 'UW', through: 'UW', though: 'OW',
    word: 'ER', world: 'ER', work: 'ER', worth: 'ER', were: 'ER', are: 'AA', the: 'AH', a: 'AH', of: 'AH',
    love: 'AH', come: 'AH', some: 'AH', done: 'AH', none: 'AH', from: 'AH', what: 'AH', was: 'AH', does: 'AH',
    gone: 'AO', have: 'AE', give: 'IH', live: 'IH', where: 'EH', there: 'EH', their: 'EH', said: 'EH',
    here: 'IY', i: 'AY', eye: 'AY', my: 'AY', by: 'AY', why: 'AY', both: 'OW', most: 'OW', ghost: 'OW', put: 'UH', could: 'UH', would: 'UH', should: 'UH',
  };

  /** Best guess at a syllable's vowel sound from its spelling, in the same ARPAbet terms. */
  function guessVowel(piece, last, only) {
    const p = piece.toLowerCase().replace(/[^a-z]/g, '');
    if (only && VOWEL_EXC[p]) return VOWEL_EXC[p];
    if (last && /^(to|do)$/.test(p)) return 'UW'; // in-to, on-to, un-do
    if (last && !only && /ery$/.test(p)) return 'IY'; // ev-ery
    const rules = [
      [/igh/, 'AY'], [/(oo|ew|ue|ui)/, 'UW'], [/ow$/, only && OW_SHORT.has(p) ? 'AW' : 'OW'], [/(ou|ow)/, 'AW'], [/(oi|oy)/, 'OY'],
      [/(ee|ea|ie(?!s?$))/, 'IY'], [/ey$/, only ? 'EY' : 'IY'], [/(ai|ay|ei)/, 'EY'], [/(oa|oe)/, 'OW'], [/(au|aw)/, 'AO'],
      [/^[^aeiou]*o$/, 'OW'], [/are$/, 'EH'], [/ar/, 'AA'], [/(er|ir|ur)/, 'ER'], [/or/, last && !only ? 'ER' : 'AO'], [/ies?$/, 'AY'],
    ];
    for (const [re, v] of rules) if (re.test(p)) return v;
    const magic = p.match(/([aeiou])[^aeiouy]es?$/); // silent-e: make, time, home, cute, bites
    if (magic) return { a: 'EY', i: 'AY', o: 'OW', u: 'UW', e: 'IY' }[magic[1]];
    if (/y$/.test(p) && !/[aeiou]/.test(p.slice(0, -1))) return only ? 'AY' : 'IY'; // my, fly · ci-ty
    const m = p.match(/[aeiouy]/);
    return m ? { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IH' }[m[0]] : '';
  }

  function lexStress(w) {
    const ph = lex[w];
    if (!ph) return null;
    const st = ph.split(' ').map((p) => (p.match(/[012]$/) || [])[0]).filter(Boolean).map(Number);
    return st.length ? st : null;
  }

  function want(w) {
    if (!api.online || w.length < 2 || w in lex || inflight.has(w) || pending.has(w)) return;
    pending.add(w);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1200);
  }

  function flush() {
    // Skip half-typed words that are no longer in the text.
    const present = new Set((corpus().toLowerCase().replace(/’/g, "'").match(/[a-z']+/g) || []).map(clean));
    for (const w of [...pending]) if (!present.has(w)) pending.delete(w);
    pump();
  }

  function pump() {
    while (busy < 4 && pending.size) {
      const w = pending.values().next().value;
      pending.delete(w);
      inflight.add(w);
      busy++;
      fetch(`${API}?sp=${encodeURIComponent(w)}&md=sr&qe=sp&max=1`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((arr) => {
          const r = arr && arr[0];
          if (r && clean(r.word) === w) {
            const tag = (r.tags || []).find((t) => t.startsWith('pron:'));
            lex[w] = tag ? tag.slice(5).trim() : '';
          } else lex[w] = '';
        })
        .catch(() => { /* network trouble: try again another time */ })
        .finally(() => {
          busy--;
          inflight.delete(w);
          scheduleNotify();
          pump();
        });
    }
  }

  function scheduleNotify() {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      infoCache.clear();
      keyCache.clear();
      try { localStorage.setItem(LEX_KEY, JSON.stringify(lex)); } catch (e) { /* storage full */ }
      window.dispatchEvent(new Event('fp:lexicon'));
    }, 300);
  }

  // ---------- public analysis ----------

  function wordInfo(raw) {
    const hit = infoCache.get(raw);
    if (hit) return hit;
    let info;
    const norm = raw.replace(/’/g, "'");
    if (/^\d+$/.test(norm)) {
      const syls = numWords(+norm).split(' ').flatMap((w) => wordInfo(w).syls);
      info = { n: syls.length, syls: syls.map((s) => ({ ...s, num: true })) };
    } else {
      const w = clean(norm);
      if (!w) info = { n: 0, syls: [] };
      else {
        let stress = lexStress(w) || lexStress(w.replace(/'/g, ''));
        const n = stress ? stress.length : heurCount(w);
        if (!stress) { want(w); stress = heurStress(w, n); }
        if (n === 1 && FUNC.has(w.replace(/'/g, ''))) stress = [0];
        const pieces = splitWord(raw, n); // keep the original characters so overlays line up
        const vs = lexVowels(w) || lexVowels(w.replace(/'/g, ''));
        info = { n, syls: pieces.map((t, i) => ({ t, s: stress[i] || 0, v: vs && vs.length === n ? vs[i] : guessVowel(t, i === n - 1, n === 1) })) };
      }
    }
    infoCache.set(raw, info);
    return info;
  }

  function analyzeLine(line) {
    const tokens = [];
    const re = /[A-Za-z0-9'’]+/g;
    let last = 0, m, count = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
      const info = wordInfo(m[0]);
      if (info.n) {
        tokens.push({ text: m[0], word: true, n: info.n, syls: info.syls });
        count += info.n;
      } else tokens.push({ text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < line.length) tokens.push({ text: line.slice(last) });
    return { tokens, count };
  }

  /**
   * Multi-syllable rhyme chains across a block of lines ("pen tight" / "then fight",
   * "city" / "pretty"): runs of 3 or 2 syllables inside a line, starting on a stressed
   * syllable, whose vowel sounds repeat elsewhere in the block with different words.
   * Returns, per line, a chain number (or -1) for each syllable of its words (numbers skipped).
   */
  function chains(lines) {
    const flat = [], out = [];
    lines.forEach((l, li) => {
      const row = [];
      analyzeLine(l).tokens.forEach((tok) => {
        if (!tok.word || (tok.syls[0] && tok.syls[0].num)) return;
        const fn = tok.n === 1 && FUNC.has(clean(tok.text).replace(/'/g, ''));
        tok.syls.forEach((x) => { row.push(-1); flat.push({ li, i: row.length - 1, v: x.v, s: x.s, t: clean(x.t), fn }); });
      });
      out.push(row);
    });
    const taken = new Set();
    let id = 0;
    for (const L of [3, 2]) {
      const groups = new Map();
      for (let i = 0; i + L <= flat.length; i++) {
        const win = flat.slice(i, i + L);
        if (win[0].s !== 1 || win.some((x) => !x.v || x.fn || x.li !== win[0].li || taken.has(x))) continue;
        const key = win.map((x) => x.v).join(' ');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      groups.forEach((starts) => {
        const keep = [], texts = new Set();
        let end = -1;
        for (const i of starts) {
          const win = flat.slice(i, i + L), txt = win.map((x) => x.t).join(' ');
          if (i < end || texts.has(txt) || win.some((x) => taken.has(x))) continue; // overlapping, or the same words again
          texts.add(txt);
          keep.push(win);
          end = i + L;
        }
        if (keep.length < 2 || new Set(keep.map((win) => win[0].li)).size < 2) return; // a chain runs across lines
        keep.forEach((win) => win.forEach((x) => { taken.add(x); out[x.li][x.i] = id; }));
        id++;
      });
    }
    return out;
  }

  /**
   * How a block of lines is written: syllables, words, how many of its words rhyme with a
   * different word in the block (density), multi-syllable rhymes (chain runs), and the rhyme
   * sounds used most, each with its words.
   */
  function stats(lines) {
    let syllables = 0, words = 0;
    const fam = new Map(); // rhyme key → the different words with it
    const keyed = [];
    lines.forEach((l) => {
      const a = analyzeLine(l);
      syllables += a.count;
      a.tokens.forEach((t) => {
        if (!t.word || (t.syls[0] && t.syls[0].num)) return;
        const w = clean(t.text).replace(/'/g, '');
        if (!w || (t.n === 1 && FUNC.has(w))) return;
        words++;
        const k = rhymeKey(t.text);
        if (!k) return;
        keyed.push(k);
        if (!fam.has(k)) fam.set(k, new Set());
        fam.get(k).add(w);
      });
    });
    const rhyming = keyed.filter((k) => fam.get(k).size > 1).length;
    const ch = chains(lines);
    const runs = new Map(); // chain id → how many places it shows up
    ch.forEach((row) => { let prev = -1; row.forEach((id) => { if (id >= 0 && id !== prev) runs.set(id, (runs.get(id) || 0) + 1); prev = id; }); });
    const top = [...fam.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size).slice(0, 3).map(([, s]) => [...s]);
    return {
      lines: lines.length, syllables, words, rhyming,
      density: words ? rhyming / words : 0,
      multis: [...runs.values()].reduce((a, n) => a + n, 0),
      top,
    };
  }

  const lineCount = (line) => analyzeLine(line).count;
  const count = (text) => (String(text).match(/[A-Za-z0-9'’]+/g) || []).reduce((a, w) => a + wordInfo(w).n, 0);

  // ---------- rhyme keys ----------

  const OW_LONG = new Set(['own', 'grown', 'known', 'shown', 'blown', 'flown', 'thrown', 'sown', 'bowl', 'bowls']);
  const OW_SHORT = new Set(['now', 'how', 'cow', 'wow', 'vow', 'allow', 'brow', 'plow', 'chow', 'eyebrow']);

  function heurKey(word) {
    let s = word;
    const one = heurCount(word) <= 1;
    if (s.length > 3 && /[^aiosu']s$/.test(s)) s = s.slice(0, -1);
    if (s.length > 3 && /[^aeiou]es$/.test(s) && !/([sxz]|ch|sh)es$/.test(s)) s = s.slice(0, -1);
    s = s.replace(/'/g, '')
      .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
      .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/wh/g, 'w')
      .replace(/eigh/g, 'A').replace(/igh/g, 'I').replace(/gh(?=t|$)/g, '').replace(/dge/g, 'j')
      .replace(/(tion|sion|cian)$/, 'shun');
    if (/[^aeiou]y$/.test(s)) s = s.slice(0, -1) + (one ? 'I' : 'E');
    if (/ie$/.test(s)) s = s.slice(0, -2) + (one ? 'I' : 'E');
    if (/ey$/.test(s)) s = s.slice(0, -2) + (one ? 'A' : 'E');
    const magic = { a: 'A', i: 'I', y: 'I', o: 'O', u: 'U', e: 'E' };
    s = s.replace(/([aeiouy])([^aeiouyAEIOU])e$/, (m, v, c) => magic[v] + c);
    if (/ow$/.test(s)) s = s.slice(0, -2) + (OW_SHORT.has(word) ? 'W' : 'O');
    if (OW_LONG.has(word)) s = s.replace(/ow/, 'O');
    s = s.replace(/ear(?=[^aeiou])/g, 'R')
      .replace(/(ee|ea|ie)/g, 'E').replace(/(ai|ay|ei|ey)/g, 'A').replace(/(oa|oe)/g, 'O')
      .replace(/(oo|ew|ue|ui)/g, 'U').replace(/(ou|ow)/g, 'W').replace(/(oi|oy)/g, 'Y')
      .replace(/(au|aw)/g, 'a').replace(/(er|ir|ur)/g, 'R');
    if (!one) s = s.replace(/(or|ar)$/, 'R');
    s = s.replace(/([^aeiouAEIOUWYR])e$/, '$1');
    const m = s.match(/([aeiouyAEIOUWYR]+)[^aeiouyAEIOUWYR]*$/);
    return m ? s.slice(m.index) : s;
  }

  const keyCache = new Map();
  /** Rhyme key of a word (cached; cleared when new pronunciations arrive). */
  function rhymeKey(word) {
    let k = keyCache.get(word);
    if (k === undefined) { if (keyCache.size > 5000) keyCache.clear(); keyCache.set(word, (k = rhymeKey0(word))); }
    return k;
  }
  function rhymeKey0(word) {
    const w = clean(word).replace(/'/g, '');
    if (!w) return '';
    const ph = lex[w];
    if (ph) {
      const parts = ph.split(' ');
      let idx = -1;
      for (let i = parts.length - 1; i >= 0; i--) if (/1$/.test(parts[i])) { idx = i; break; }
      if (idx < 0) for (let i = parts.length - 1; i >= 0; i--) if (/[02]$/.test(parts[i])) { idx = i; break; }
      if (idx >= 0) {
        const tail = parts.slice(idx).map((p) => p.replace(/[012]$/, ''));
        if (tail.length > 1 && tail[tail.length - 1] === 'Z') tail.pop();
        else if (tail.length > 2 && tail[tail.length - 1] === 'S' && !/^[AEIOU]/.test(tail[tail.length - 2])) tail.pop();
        return 'P:' + tail.join(' ');
      }
    }
    return 'H:' + heurKey(w);
  }

  /** The vowel sound of the rhyming syllable, used for near/slant rhymes offline. */
  function vowelKey(word) {
    const k = rhymeKey(word);
    if (k.startsWith('P:')) return k.split(' ')[0];
    const m = k.slice(2).match(/^[aeiouyAEIOUWYR]+/);
    return 'H:' + (m ? m[0] : '');
  }

  const api = {
    online: true,
    clean,
    count,
    lineCount,
    analyzeLine,
    wordInfo,
    chains,
    stats,
    rhymeKey,
    vowelKey,
    heurCount,
    setCorpus(fn) { corpus = fn; },
    clearLexicon() { lex = {}; infoCache.clear(); keyCache.clear(); try { localStorage.removeItem(LEX_KEY); } catch (e) { /* ignore */ } },
    lexiconSize: () => Object.keys(lex).length,
  };
  FP.syl = api;
})();
