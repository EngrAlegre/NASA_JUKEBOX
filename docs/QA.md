# Verification

What was actually run, what it returned, and what remains untested. Every claim
below is reproducible with a command in this repository.

```bash
node tests/engine.test.js     # 59 assertions, pure functions, no browser
node tools/qa.js              # 18 checks in a real browser -> docs/qa-report.json
node tools/render_sides.js    # renders all sides to WAV through the app's own engine
```

Last full run: **59 + 18 checks, 0 failures.**

---

## 1. Engine (`node tests/engine.test.js`)

Pure-function tests over `src/analyze.js` and `src/sonify.js`. No DOM, no audio,
no network — the parts a reviewer can audit without listening.

| Area | Assertions | Example |
|---|---|---|
| Coverage and silence | 6 | a fully transparent frame reports zero coverage and is flagged empty; a half-transparent frame reports 50% |
| Colour axis | 3 | a warm colour lands at 1.0 on a cool→warm axis, a cool colour at 0.0 |
| Texture | 4 | the busiest column tracks a bright block placed at 60% of the width |
| Absolute vs relative texture | 2 | a solid black frame has no absolute texture **and writes no melodic notes** |
| Determinism | 1 | the same features compose to byte-identical events |
| Modal safety | 2 | every pitch of every bar, including extremes, belongs to the record's mode |
| Tempo | 2 | tempo stays inside the record's range and moves at most 7 BPM per bar |
| Arrangement | 3 | 18 frames → 18 bars; sections move intro → outro; every bar has a usable duration |
| Calibration | 1 | a side with no variation falls back to neutral rather than amplifying noise |
| Language | 2 | the description names the bar and speaks in words, not measurements |

The mode test is the important one: it walks every note the composer produced
from three extreme frames and asserts each interval against the scale set, so
"no measurement can produce a wrong note" is enforced rather than asserted.

## 2. Browser (`node tools/qa.js`)

Headless Chromium over the DevTools Protocol. No Playwright, no Puppeteer — the
CDP socket is Node's built-in `WebSocket`, so the harness has no dependencies
either.

### Accessibility tree

| Check | Result |
|---|---|
| Every interactive node has an accessible name | 45 of 45 named |
| Exactly one `h1` | yes — then `h2` shelf / now playing / method, `h3` per step |
| A live region exists | 2 (`aria-live` status regions) |
| Stage image is described by generated text | `aria-labelledby` → *"Bar 1 of 18 of City Lights. The frame is nearly black, cool-…"* |
| Current bar marked with `aria-current` | 1 |
| Selected record marked `aria-pressed` | 1 |
| Meters carry numeric labels, not just bars | 6 of 6 |

### Keyboard

| Check | Result |
|---|---|
| Tab reaches the instrument's controls | 45 distinct stops |
| Play control reachable by Tab | yes, after the filmstrip |
| Space starts playback | `aria-pressed=true` |
| Arrow steps to the next bar | `frame 2 / 18` |

### Export

The test clicks the **real button** and waits for the browser's download:

```
earth-jukebox-nightlights.wav — 9.3 MB, RIFF/WAVE, 52.7 s, 44100 Hz, 2 ch
```

That is the same duration the command-line renderer produces (52.5 s), which
confirms the in-page export and the batch renderer are running the same graph.

### Reduced motion

Reloaded with `prefers-reduced-motion: reduce` emulated: the score still draws
(25,148 lit pixels), the side still loads 18 bars, and no exceptions are raised.

### Timing

First side playable **856–1,447 ms** after navigation across runs (18 frames
fetched from local disk and analysed). Composition itself is 1–3 ms; the cost is
image decode.

## 3. Audio (`node tools/render_sides.js`)

Every side rendered through a real browser's `OfflineAudioContext` — the same
`createEngine()` used for playback.

| Side | Duration | Peak | Integrated loudness |
|---|---|---|---|
| City Lights | 52.5 s | 0.960 | −16.9 LUFS |
| Carbon Weather | 57.9 s | 0.880 | −17.8 LUFS |
| Canopy | 52.0 s | 0.839 | −16.4 LUFS |
| Lightning | 36.7 s | 0.901 | −19.1 LUFS |
| Ocean Heat | 63.1 s | 0.756 | −17.2 LUFS |

No clipping (peak < 0.97), all inside a −16 to −19 LUFS window. A log-scale
spectrogram of a rendered side shows sustained harmonic stacks, rhythmic
vertical striations, and a clear section change — structure, not noise.

Render cost: 12–26 s for 36–63 s of audio, which is why the Export button shows
a progress state instead of pretending to be instant.

## 4. Console hygiene

`tools/shoot.js` and `tools/qa.js` both collect `Runtime.exceptionThrown` and
`Log.entryAdded`. Clean across: initial load, playing, stepping, switching all
five records, the live tuner fetching 18 GIBS frames, and export.

## 5. Deployment (`docs/DEPLOY.md`)

Deployability was tested on the two paths that actually differ, not assumed:

| Scenario | What was run | Result |
|---|---|---|
| **Subpath with a space** (the GitHub Pages `/repo-name/` case) | served the parent folder and loaded `/Nasa%20Jukebox/` | 5 records, 18 bars, no errors; covers, frames and `audio/canopy.mp3` all resolved under `/Nasa%20Jukebox/…` |
| **Container** | `docker build -t earth-jukebox:test .` → `docker run -p 8099:80` | image **35.7 MB**; `/`, `src/app.js`, `data/records.js`, `data/records/ocean/f001.png`, `audio/co2.mp3`, `og.png`, `docs/QA.md` all **200**; a missing path returns **404** |
| **Headers as configured** | `curl -sI` against the container | `Content-Security-Policy`, `X-Content-Type-Options` present; `Cache-Control: no-cache` on HTML, immutable on `/data` and `/audio` |
| **CSP does not break the app** | full `tools/qa.js` run with the policy active | 18/18 passing, including the blob: WAV download and the GIBS live tuner |
| **Container serves the real app** | headless load through port 8099 | 5 records, 18 bars, frames resolved, no console errors |

Two bugs were found by doing this rather than writing it down:

1. `.dockerignore` listed `nginx.conf`, which the Dockerfile copies — the build
   would have failed. Caught by checking every `COPY` source against the ignore
   patterns.
2. `nginx.conf` originally set `Cache-Control` with `add_header` inside
   `location` blocks, which silently drops every header inherited from the
   `server` block — including the CSP. Rewritten to use `expires`, which does not
   break inheritance.

Not tested: Netlify, Vercel and Cloudflare Pages (no accounts), and the GitHub
Actions workflow has not executed on GitHub's runners. The workflow's steps are
the same commands verified locally, but that is a claim about equivalence, not a
green check.

## 6. What is **not** verified

Stated plainly, because a verification document that only lists successes is
marketing:

- **No real screen reader was run.** The ARIA is written against the WAI-ARIA
  authoring practices and confirmed through Chrome's accessibility tree, but
  NVDA, JAWS and VoiceOver were not exercised. The tree check proves *names and
  roles exist and are wired*; it does not prove the reading order is pleasant or
  that announcements are not too chatty during playback.
- **No blind or low-vision participants.** The claim that the sonification is
  *useful* to a blind listener is a design argument, not a finding. Testing it
  is the first thing to do next.
- **Safari and Firefox were not exercised** in this build. The code avoids
  Safari-specific hazards (no `webkitAudioContext` requirement is assumed beyond
  a fallback, `createStereoPanner` is feature-detected) but "avoids" is not
  "tested".
- **No mobile hardware.** Layout was checked at 400 × 860 in desktop Chromium's
  emulation, not on a phone. iOS audio unlock behaviour in particular is untested.
- **No load or soak test.** Eighteen bars loop indefinitely; a multi-hour session
  was not run.
- **Musical judgement is unverified by ear.** The mix was measured (loudness,
  peaks, spectral balance, per-bar RMS arc) but not auditioned by a person in
  this environment. Every number above is real; whether it *sounds good* is
  still a human judgement.

## 7. How to re-run everything

```bash
python tools/build_library.py      # rebuild frames from NASA (cached, no re-download)
node tests/engine.test.js          # 59 engine assertions
python tools/serve.py &            # a static server, because canvas needs http://
node tools/qa.js                   # 18 browser checks -> docs/qa-report.json
node tools/render_sides.js         # WAVs -> audio/, then measure with ffmpeg
node tools/shoot.js <url> <png>    # screenshot + console capture for any page
```
