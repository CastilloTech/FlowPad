/* LosSoulx FlowPad — the metronome sheet. */
'use strict';

// =====================================================================
// METRONOME — a click layer that runs alongside the beat and recording
// =====================================================================
function openMetronome() {
  if (!E) return;
  const sh = sheet({
    title: 'Metronome',
    html: `<div class="metro">
      <div class="mbeats" id="mb"></div>
      ${bpmCtl(curBpm())}
      <input type="range" class="range" id="mbr" min="40" max="220" value="${curBpm()}" aria-label="Tempo">
      <div class="seg wide" id="mts">${['2/4', '3/4', '4/4', '6/8'].map((x) => `<button data-ts="${x}" class="${x === S.settings.timeSig ? 'on' : ''}">${x}</button>`).join('')}</div>
      <div class="mrow"><button class="btn" id="mtap">Tap tempo</button><label class="btn" style="justify-content:space-between">Accent <input type="checkbox" class="switch" id="macc" ${S.settings.accent ? 'checked' : ''}></label></div>
      <button class="btn primary block" id="mplay">${T.click ? 'Stop click' : 'Start click'}</button>
      <p class="src" style="margin-top:0">The click layers over the beat — keep writing and recording while it runs.</p>
    </div>`,
  });
  const el = sh.el;
  const dots = () => { $('#mb', el).innerHTML = range(T.drums ? 4 : sig().n).map((i) => `<i class="${i === 0 && S.settings.accent ? 'a' : ''}"></i>`).join(''); };
  dots();
  $('#mplay', el).addEventListener('click', () => { T.click = !T.click; E.syncTransport(!audio.state().playing); if (!T.click) dots(); });
  $('#mbr', el).addEventListener('input', (e) => setBpm(+e.target.value));
  $('#mts', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-ts]');
    if (!b) return;
    S.settings.timeSig = b.dataset.ts;
    saveSettings();
    $$('#mts button', el).forEach((x) => x.classList.toggle('on', x === b));
    dots();
    if (T.click && !T.drums) E.syncTransport(true);
  });
  $('#macc', el).addEventListener('change', (e) => { S.settings.accent = e.target.checked; saveSettings(); audio.update({ accent: e.target.checked }); dots(); });
  let taps = [];
  $('#mtap', el).addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    taps = taps.slice(-5);
    if (taps.length >= 2) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      setBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    }
  });
}
