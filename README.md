# LosSoulx FlowPad

A minimalist, mobile-first rap writing app. It's an installable web app (PWA) with no build step and no dependencies. Everything is saved on your device.

## Run it

```bash
npm start            # serves the app at http://localhost:5173
npm test             # unit tests: syllables, rhyme chains, step editing, beat structure (Node 20+)
```

Open it in your browser. On a phone, use **Share → Add to Home Screen** (iOS) or **Install app** (Android) and it runs full-screen and works offline.

> **Microphone note:** browsers only allow recording on `https://` or `localhost`. To record on your phone, host the folder on any HTTPS static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). No config is needed.

## Features — all on one screen

Each song opens as a **flow sheet**: every bar is a 16-step grid, and you write straight into the steps. Tap a step and type. **Space** moves to the next step, and a longer word splits itself into syllables across the empty steps after it (`syllable` → `syl-` `la-` `ble`); empty steps are rests, and ending a syllable with `-` carries the word into the next step (`ci-` `ty` → "city"). **Enter** starts the next bar; **Backspace** on an empty step steps back. Words you type or drop in push the words already there along instead of overwriting them, carrying over into the next bar when a bar is full. **Hold a step** (or drag it with a mouse) to move it onto any step in any bar; dropped on words, you choose **Replace** or **Shift words along**. Let go in place to insert a rest or delete a step. Kicks, snares and hats sit on top of the steps, and each bar's full line is shown above its grid. A bar's ⋯ menu can re-flow its words (spread evenly, or one syllable per step) and insert, clear or delete bars. Bars show their own beat only when it differs from the song beat, and tips and the legend fold away under the sheet. Long songs stay quick: only the bars you change are redrawn, and off-screen bars are skipped. **Undo / redo** sit above the sheet (Ctrl+Z / Ctrl+Shift+Z on a keyboard) and cover every edit, including drags and recorded words. The dock underneath holds everything else, and all of it can run together.

| | |
|---|---|
| **Syllable counter** | A live count on every bar, plus bar count, total and average per bar. |
| **Syllable stresses** | Always on, painted directly on your lyrics and on the grid. Stressed syllables are shown in bright CAPS and unstressed ones are grey. Words that rhyme with line endings share a coloured underline, which also catches internal rhymes. **Rhyme chains** shade multi-syllable runs whose vowel sounds repeat across lines within a section ("pen tight" / "then fight", "city lights" / "pretty nights"); toggle them in the legend. |
| **Drum pattern placement** | The chip at the top sets the song beat. Tap a bar's beat label to give that bar, or its whole section, a different pattern or a rest. **Play** loops the song bar by bar, lighting up the playing bar and step. The **Beat** panel is a 5-track, 16-step sequencer for editing patterns. **Import your own beat** (MP3, WAV…) there too: the tempo is read from the file name or guessed from the audio, you can tap it or set where bar 1 starts, and the loop plays on the bar lines — the grid, recording and words-to-steps all follow it. Changing the song's BPM speeds the beat up or down (pitch moves with it). For a full-length beat, FlowPad finds its **structure** — where it changes (on 4-bar lines) and what each part is (Intro, Verse, Hook, Outro, by how full it sounds) — shows it as a strip you can tap to jump around, and can **lay out your song to match**: a label where each section starts and enough bars to cover the beat, lyrics kept in order (Undo puts it back). Edit the sections or detect again any time. |
| **Rhyme suggestions** | The strip above the dock follows the last word of your previous bar, or the word under your cursor. Tap a rhyme to insert it. The **Rhymes** panel follows along too, with perfect, near and sounds-like rhymes grouped by syllable count. Hold a word to save it to your bank. |
| **Voice recordings** | **Rec** records over whatever is playing. If nothing is playing, it can start the beat for you. With **Write my words into the steps** on (Takes panel), what you rap is transcribed and each syllable lands on the step you said it on — empty bars that played get filled, everything else goes into new bars at the end. Needs Chrome, Edge or Safari; headphones give the cleanest timing. A one-bar **count-in** plays first when Rec starts the beat. Takes (play, rename, download, share) are in the **Takes** panel; playing a take brings back the beat you recorded over, in time, and the grid follows along. A take's ⋯ menu can **write its words into the steps** again. |
| **Metronome** | Tap the BPM pill. The click layers over the beat. It has tap tempo, 2/4 · 3/4 · 4/4 · 6/8, and accent. |
| **Word bank** | The **Bank** panel explores words associated with a theme. Saved words appear in the strip; tap one to insert it. |
| **Projects → Folders → Files** | Organise albums, tracks and verses. Rename, move, duplicate, delete, and search across all your lyrics. |

Other details: black/blue dark theme, plus light and system themes; JSON backup export and import, with a reminder on the home screen when lyrics have changed and the last backup is over a week old (backups hold lyrics, folders and patterns — takes and imported beats stay on the device); the app asks the browser to keep its storage permanently; share, .txt export, or **print / save as PDF** from a song's ⋯ menu; and `[Verse]` / `Hook:` lines are treated as section labels, not bars.

## How the language features work

- **Offline:** syllable counts, stresses and rhymes come from built-in heuristics, a starter word list, and the words you've already written.
- **Online (default):** words are looked up in the free [Datamuse API](https://www.datamuse.com/api/), which is based on the CMU Pronouncing Dictionary. This gives exact syllables and stresses, plus far better rhymes and associations. Results are cached on the device. You can turn this off in Settings.

## Files

```
index.html            app shell + icon sprite
css/styles.css        all styles (design tokens at the top)
js/db.js              IndexedDB storage
js/syllables.js       syllable counting, splitting, stress, vowel sounds, rhyme keys and chains
js/words.js           rhymes + associations (Datamuse with offline fallback)
js/sheet.js           the step model: laying words onto steps, push / pull / move (no DOM, unit-tested)
js/structure.js       an imported beat's sections, and laying a song out to match (no DOM, unit-tested)
js/audio.js           drum synth, transport (step-timing log, count-in), imported beat loops, metronome, mic recorder
js/voice.js           speech recognition + syllable onsets → words onto steps
js/app.js             screens, navigation, editor tabs
sw.js                 offline cache (bump VERSION after editing files)
server.js             zero-dependency dev server
tests/                node:test unit tests (npm test)
```
