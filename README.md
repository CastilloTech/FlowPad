# FlowPad

A minimalist, mobile-first rap writing app. It's an installable web app (PWA) with no build step and no dependencies. Everything is saved on your device.

## Run it

```bash
npm start            # serves the app at http://localhost:5173
```

Open it in your browser. On a phone, use **Share → Add to Home Screen** (iOS) or **Install app** (Android) and it runs full-screen and works offline.

> **Microphone note:** browsers only allow recording on `https://` or `localhost`. To record on your phone, host the folder on any HTTPS static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). No config is needed.

## Features — all on one screen

Each song opens as a **flow sheet**: every bar is a 16-step grid, and you write straight into the steps. Tap a step and type. **Space** moves to the next step, empty steps are rests, and ending a syllable with `-` carries the word into the next step (`ci-` `ty` → "city"). **Enter** starts the next bar; **Backspace** on an empty step steps back. Kicks, snares and hats sit on top of the steps, and each bar's full line is shown above its grid. A bar's ⋯ menu can re-flow its words (spread evenly, or one syllable per step) and insert, clear or delete bars. The dock underneath holds everything else, and all of it can run together.

| | |
|---|---|
| **Syllable counter** | A live count on every bar, plus bar count, total and average per bar. |
| **Syllable stresses** | Always on, painted directly on your lyrics and on the grid. Stressed syllables are bright and unstressed ones are grey. Words that rhyme with line endings share a coloured underline, which also catches internal rhymes. |
| **Drum pattern placement** | The chip at the top sets the song beat. Tap a bar's beat label to give that bar, or its whole section, a different pattern or a rest. **Play** loops the song bar by bar, lighting up the playing bar and step. The **Beat** panel is a 5-track, 16-step sequencer for editing patterns. |
| **Rhyme suggestions** | The strip above the dock follows the last word of your previous bar, or the word under your cursor. Tap a rhyme to insert it. The **Rhymes** panel follows along too, with perfect, near and sounds-like rhymes grouped by syllable count. Hold a word to save it to your bank. |
| **Voice recordings** | **Rec** records over whatever is playing. If nothing is playing, it can start the beat for you. Takes (play, rename, download, share) are in the **Takes** panel. |
| **Metronome** | Tap the BPM pill. The click layers over the beat. It has tap tempo, 2/4 · 3/4 · 4/4 · 6/8, and accent. |
| **Word bank** | The **Bank** panel explores words associated with a theme. Saved words appear in the strip; tap one to insert it. |
| **Projects → Folders → Files** | Organise albums, tracks and verses. Rename, move, duplicate, delete, and search across all your lyrics. |

Other details: dark, light and system themes; JSON backup export and import; and `[Verse]` / `Hook:` lines are treated as section labels, not bars.

## How the language features work

- **Offline:** syllable counts, stresses and rhymes come from built-in heuristics, a starter word list, and the words you've already written.
- **Online (default):** words are looked up in the free [Datamuse API](https://www.datamuse.com/api/), which is based on the CMU Pronouncing Dictionary. This gives exact syllables and stresses, plus far better rhymes and associations. Results are cached on the device. You can turn this off in Settings.

## Files

```
index.html            app shell + icon sprite
css/styles.css        all styles (design tokens at the top)
js/db.js              IndexedDB storage
js/syllables.js       syllable counting, splitting, stress, rhyme keys
js/words.js           rhymes + associations (Datamuse with offline fallback)
js/audio.js           drum synth, transport, metronome, mic recorder
js/app.js             screens, navigation, editor tabs
sw.js                 offline cache (bump VERSION after editing files)
server.js             zero-dependency dev server
```
