# LosSoulx FlowPad

A minimalist, mobile-first rap writing app. It's an installable web app (PWA) with no dependencies, and no build step needed to work on it. Everything is saved on your device — see [Privacy](privacy.html).

**Live:** https://castillotech.github.io/FlowPad/

## Run it

```bash
npm start            # serves the app at http://localhost:5173
npm test             # unit tests: syllables, rhyme chains, step editing, beat structure (Node 20+)
npm run e2e          # end-to-end tests in a headless Chrome / Edge (npm run e2e -- <name> runs one)
npm run build        # the published site in _site/, JS + CSS minified (SITE_DIR=_site npm start serves it)
node tools/images.mjs  # re-render the link-preview card and the install screenshots
```

Open it in your browser. On a phone, use **Share → Add to Home Screen** (iOS) or **Install app** (Android) and it runs full-screen and works offline.

> **Microphone note:** browsers only allow recording on `https://` or `localhost`. To record on your phone, host the folder on any HTTPS static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). No config is needed.

## Features — all on one screen

Each song opens as a **flow sheet**: every bar is a 16-step grid, and you write straight into the steps. Tap a step and type. **Space** moves to the next step, and a longer word splits itself into syllables across the empty steps after it (`syllable` → `syl-` `la-` `ble`); empty steps are rests, and ending a syllable with `-` carries the word into the next step (`ci-` `ty` → "city"). **Enter** starts the next bar; **Backspace** on an empty step steps back. Words you type or drop in push the words already there along instead of overwriting them, carrying over into the next bar when a bar is full. **Hold a step** (a ring fills, then it lifts; with a mouse, just drag) to move it onto any step in any bar: the label snaps onto steps, and over words they slide along to preview the **shift** you'll get — pause on them to **replace** instead. Let go where you started for insert / delete step; drop off the grid to cancel. **Swipe a bar** left to delete it or right to duplicate it, with **Undo** right in the message. Words glide to their new steps after drops, pushes and undo, sheets and panels **swipe down** to close, screens slide in the direction you're going, and the playhead follows the display's own frames, offset for speaker delay. Optional **soft sounds** and (on Android) **vibration** are in Settings; everything respects the phone's reduce-motion setting. Kicks, snares and hats sit on top of the steps, and each bar's full line is shown above its grid. A bar's ⋯ menu → **Rhythm** re-lays its words (spread evenly, one syllable per step, or onto a **flow** — a rhythm saved from another bar or a built-in one like On the beat or Syncopated, for one bar or a whole section) and insert, clear or delete bars. Bars show their own beat only when it differs from the song beat. A bar's header stays quiet: one small chip appears only when there's something to say (triplets, a guide, a repeated cadence, stresses off the pocket), and tapping it explains what it means and what to do about it. Tips appear once each, as **coach marks** next to what they're about, when they're useful (Settings → Show tips again). Long songs stay quick: only the bars you change are redrawn, and off-screen bars are skipped. **Undo / redo** sit above the sheet (Ctrl+Z / Ctrl+Shift+Z on a keyboard) and cover every edit, including drags and recorded words. The dock underneath holds everything else, and all of it can run together.

| | |
|---|---|
| **Syllable counter** | A live count on every bar. Tap the stats line above the sheet for **song stats** — bars, syllables per bar, how many words rhyme, multi-syllable rhymes, top rhyme sounds, per section — and a **syllables-per-bar target**: bars more than one off get a +/− marker. |
| **Syllable stresses** | Always on, painted directly on your lyrics and on the grid. Stressed syllables are shown in bright CAPS and unstressed ones are grey. Different words that rhyme anywhere in a section — at the ends of bars or inside them (take / bake, run / sun) — share a coloured underline, and selecting a step lights up every word in the song that rhymes with it. **Rhyme chains** shade multi-syllable runs whose vowel sounds repeat across lines within a section ("pen tight" / "then fight", "city lights" / "pretty nights"); toggle them in the legend. |
| **Drum pattern placement** | The beat chip at the top opens the **Beat** panel, where the song beat is set. Tap a bar's beat label to give that bar, or its whole section, a different pattern or a rest. **Play** loops the song bar by bar, lighting up the playing bar and step. The **Beat** panel is a 5-track, 16-step sequencer for editing patterns. **Import your own beat** (MP3, WAV…) there too: the tempo is read from the file name or guessed from the audio, you can tap it, set where bar 1 starts, or **line it up by ear** (bar 1 plays with a click on every beat while you nudge it ±10 / ±50 ms), and the loop plays on the bar lines — the grid, recording and words-to-steps all follow it. Changing the song's BPM speeds the beat up or down (pitch moves with it). For a full-length beat, FlowPad finds its **structure** — where it changes (on 4-bar lines) and what each part is (Intro, Verse, Hook, Outro, by how full it sounds) — shows it as a strip you can tap to jump around, and can **lay out your song to match**: a label where each section starts and enough bars to cover the beat, lyrics kept in order (Undo puts it back). Edit the sections or detect again any time. |
| **Rhyme suggestions** | The strip above the dock follows the last word of your previous bar, or the word under your cursor. Tap a rhyme to put it on the selected step — into a rest, or in place of the word that's there (with Undo). The **Rhymes** panel follows along too, with perfect, near and sounds-like rhymes grouped by syllable count. Hold a word to save it to your bank. |
| **Voice recordings** | **Rec** records over whatever is playing. If nothing is playing, it can start the beat for you. With **Write my words into the steps** on (Takes panel), what you rap is transcribed and each syllable lands on the step you said it on — empty bars that played get filled, everything else goes into new bars at the end. Needs Chrome, Edge or Safari; headphones give the cleanest timing. A one-bar **count-in** plays first when Rec starts the beat; the ⚙ in the **Takes** panel holds the recording options. Takes (play, rename, download, share) are in the **Takes** panel; playing a take brings back the beat you recorded over, in time, and the grid follows along. A take's ⋯ menu can **write its words into the steps** again, or **export it with the beat** — one WAV of your take over the drums or imported beat it was recorded on, lined up the way you heard it. **Settings → Headphone delay** measures your real delay by tapping along to clicks (Bluetooth headphones add 150–300 ms the browser often doesn't know about); recording into steps, take playback and the playhead all use it. |
| **Cadences** | Write the rhythm, not just the words. A bar's ⋯ menu → **Rhythm** has a **cadence library** (On the beat, Laid back, Boom bap bounce, Double time, Triplet bounce…), each with a note on how it feels and a **▶ preview** you can hear before laying words on it, for one bar or a whole section. Switch a bar's **grid** to **triplets** (12 steps) or **fast triplets** (24); your words keep their timing. **Tap a cadence in**: after a bar of count-in clicks, tap the rhythm you hear in your head. Then lay the bar's words on it, save it as a cadence, or use it as a **guide**, which marks its slots so each word you type lands in the next one. **Hear this bar** plays it twice over its beat with every syllable as a blip, and the Beat panel's **Words** switch blips your lyrics over the whole song. **Pocket check** (in the legend) shows how many stressed syllables land on the beat's 8ths, kicks and snares, and marks the ones that don't. A **≡N** badge flags bars that repeat the cadence of the bars before. The song stats give a **cadence variety** score and point out long runs to switch up. |
| **Look & feel** | On phones you type in a **typing bar** above the keyboard, with the bar's line (stresses lit, your step marked) right above it and rhymes below it. Settings → Typing switches back to typing on the step. While the beat plays, the sheet moves with it: the playing bar **pulses on each beat** and each syllable **pops** as it's heard. **Pinch the grid** (or Settings → Step size) for bigger steps or more of the song on screen. With **Soft sounds** on, the app plays quiet notes, all in one key (A minor pentatonic, like the clicks and blips): when a word lands, a bar finishes, you save, undo or delete. On Android, **vibration** follows the rhythm: firmer on the beat, a double tap when a guide slot fills, a little figure when a bar is done. Sheets and panels spring in and follow your finger. A new song or empty project says how to start, with the buttons to do it, and placeholders show while the library loads. On **tablets and landscape** phones, panels sit beside the sheet and pop-up sheets slide in from the side. Settings has five **accent colours** and a **high-contrast** mode, in dark or light. |
| **Metronome** | Tap the BPM pill. The click layers over the beat. It has tap tempo, 2/4 · 3/4 · 4/4 · 6/8, and accent. |
| **Word bank** | The **Bank** panel explores words associated with a theme. Saved words appear in the strip; tap one to insert it. |
| **Projects → Folders → Songs** | Organise albums, tracks and verses. Rename, move, duplicate, delete, and search across all your lyrics. |
| **Song versions** | A song's ⋯ menu → **Versions** shows snapshots, newest first: saved by themselves when you finish an editing session and before big changes (laying out to a beat, a flow over a section, words from a take, restoring), plus any you **save with a name**. Preview one, then **Restore** it (the song as it is now is kept as a version first) or **copy it as a new song**. Named versions are kept; the newest 40 automatic ones are. |

Other details: black/blue dark theme, plus light and system themes; JSON backup export and import, with a reminder on the home screen when lyrics have changed and the last backup is over a week old (backups hold lyrics, folders and patterns — takes and imported beats stay on the device); the app asks the browser to keep its storage permanently, offers to install itself from your second visit, and shows a calm "your lyrics are saved" card with a ready-made bug report if something breaks; share, copy, .txt or **print / save as PDF** under a song's ⋯ → **Share & export**; and `[Verse]` / `Hook:` lines are treated as section labels, not bars.

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
js/cadence.js         a bar's rhythm: pocket check, repeated cadences, variety, taps → steps (no DOM, unit-tested)
js/audio.js           drum synth, transport (step-timing log, count-in), imported beat loops, metronome, mic recorder
js/voice.js           speech recognition + syllable onsets → words onto steps
js/app/core.js        helpers, state, saving, dialogs, routing, menus, backups, install offer, crash card
js/app/library.js     home, projects, folders, settings, headphone delay test
js/app/versions.js    song versions: snapshots, restore, copy
js/app/editor.js      the editor's writing side: the sheet, typing, drag, undo, rhymes and bank
js/app/editor-audio.js  the editor's audio side: beat panel, imported beats + structure, recorder, takes, transport
js/app/metronome.js   the metronome sheet
js/app/boot.js        start-up
privacy.html          what stays on the device and what doesn't
sw.js                 offline cache (bump VERSION after editing files)
server.js             zero-dependency dev server (SITE_DIR serves another folder)
tests/*.test.cjs      node:test unit tests
tests/e2e/            end-to-end scenarios + a dependency-free headless-browser driver
tools/                build (minify), share card and screenshots
.github/workflows/    test on every push; publish to Pages when everything passes
```

The `js/app/*.js` files are classic scripts that share one global scope, loaded in order by `index.html`.

## Publishing

Every push to `main` runs the unit tests, builds the minified site, runs the end-to-end tests on that build, and only then publishes it to GitHub Pages. Pull requests get the same checks without publishing. **One-time setup:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### Your own domain

1. Buy a domain (or use one you have) and add a DNS record: for a subdomain like `flowpad.example.com`, a **CNAME** pointing to `castillotech.github.io`; for a bare domain, GitHub's **A** records (see GitHub's "Managing a custom domain" guide).
2. Repo **Settings → Pages → Custom domain** → enter it → wait for the DNS check → tick **Enforce HTTPS**.
3. Update the absolute URLs in `index.html` (`canonical`, `og:url`, `og:image`) to the new address.
4. **Your lyrics don't move with the address.** Browser storage belongs to the old address, so export a backup there and import it on the new one — and tell your users to do the same.

### Google Play

FlowPad can be wrapped as an Android app (a Trusted Web Activity) that opens the live site full-screen:

1. Install Java and the Android SDK, then `npx @bubblewrap/cli init --manifest <site>/manifest.webmanifest` and `npx @bubblewrap/cli build`. Keep the signing key it creates somewhere safe.
2. Publish the site's ownership proof at `https://<your domain>/.well-known/assetlinks.json` (Bubblewrap prints it). It must be at the **root** of the domain, so this step needs your own domain (above) — a `github.io/FlowPad` project page can't serve it.
3. Create a Google Play developer account (one-time fee), upload the `.aab`, and use `icons/screens/*.png` for the store screenshots.

The Apple App Store doesn't accept apps that are only a website wrapper; on iPhone, Add to Home Screen is the way.
