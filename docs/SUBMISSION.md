# Submission notes

Everything a judge needs, in the order they usually need it.

---

## The pitch

**The Earth Information Jukebox turns NASA's Earth Information Center visuals
into playable records.** Every frame is measured pixel by pixel and becomes one
bar of music, so the same data arrives through your eyes and your ears at the
same moment — and a blind listener is given the measurements, not a summary of
the picture.

Five sides, one per sphere of the Earth system, plus a live tuner that will build
a new side from whatever the planet did in the last eighteen frames.

## The sixty-second demo

1. **Run `python tools/serve.py`** and open the address it prints. The shelf is on
   the left. *(no build, no dependencies; the server exists only because browsers
   will not expose canvas pixels over `file://`)*
2. **Click City Lights, press Play.** Watch the playhead sweep left to right
   across the map while the piano roll fills in underneath: sixteen columns of
   the map, sixteen melodic steps.
3. **Watch the meters.** Luminance → octave, colour-bar position → scale degree,
   texture → subdivision, frame-to-frame change → tempo. They move as the music
   moves.
4. **Press `D`.** The current bar is described aloud, from the same numbers.
5. **Switch to Lightning** with the arrow keys. Same instrument, completely
   different piece — percussion-first, because that record is made of transients.
6. **Click "Export WAV".** The whole side renders to a file in ~15 s, through the
   same audio graph you just heard.
7. **Scroll to Method.** The mapping table, with the two artistic rules marked as
   such.

If there is time: **Tune in** on the live panel, and watch a brand-new side get
built from today's sea surface temperature.

## How it answers the brief

| The brief asked for | Where it lives |
|---|---|
| Pair EIC visual frames with dynamic sonifications generated in real time | `src/app.js` schedules the side live; `src/sonify.js` composes it from measurements of the actual EIC frames in `data/records/` |
| Let someone select a visualization and experience it with its soundscape | The shelf, the filmstrip, and the transport |
| Translate visual data into sound: colour, brightness, shape, pixel density | Twelve measured features → twelve musical parameters, tabulated in the UI and in `README.md` |
| Balance data interpretation with music that is pleasing | Fixed modes, tempo glide clamped at 7 BPM/bar, arrangement arc, voice leading via chord inversion |
| Accessibility as a core theme | Generated per-bar descriptions, speech synthesis, `aria-live` narration, full keyboard control, high-contrast theme, reduced motion — see `docs/ACCESSIBILITY.md` |
| Document the process and the "why" | `docs/DESIGN.md`, including four rejected datasets and the bug that the narration caught |
| Use NASA data and resources | Four records from the EIC content database (SVS), one from GIBS; live tuner on GIBS |

## Resources used, and what was done with them

- **Earth Information Center content database (SVS)** — four records:
  *Change in Night Lights 2012–2023 (EIC Version)*, *DYAMOND Global Carbon
  Dioxide*, *GEDI Forest Height*, *Lightning Events Detected from the ISS*.
  Frames sampled from the published renditions; real credits, dataset names and
  visualizer names parsed from each SVS page and shown in the app's liner notes.
- **NASA GIBS** — the *Ocean Heat* side (GHRSST MUR sea surface temperature, last
  18 days) and every frame of the live tuner.
- **Two resources were tried and rejected on inspection** — *Perpetual Ocean 2*
  sea ice (published as a black alpha matte) and the *Air Quality* preview (a
  four-panel comparison reel). Both rejections are documented in
  `docs/DESIGN.md` §2, because "we tried it and it did not survive contact with
  the pixels" is more useful than silently omitting them.

## Evidence the thing works

Every claim below is reproducible with a command in the repository. Full detail,
including what is **not** verified, is in [`docs/QA.md`](docs/QA.md).

| What | How | Result |
|---|---|---|
| Analysis + composition | `node tests/engine.test.js` | **59 assertions**, 0 failures — including a check that every note of every side belongs to its mode |
| Accessibility tree | `node tools/qa.js` | **45 of 45 interactive nodes named**, one `h1`, 2 live regions, `aria-current` on the playing bar, `aria-pressed` on the selected record, 6 meters with numeric labels |
| Keyboard | `node tools/qa.js` | **45 distinct Tab stops**; space starts playback, arrows step bars |
| Export button | `node tools/qa.js` (clicks the real button) | `earth-jukebox-nightlights.wav` — RIFF/WAVE, **52.7 s, 44.1 kHz stereo**, 9.3 MB |
| Reduced motion | `node tools/qa.js` (emulated) | score still draws, side still loads, no exceptions |
| Audio | `node tools/render_sides.js` | five sides at **−16.4 to −19.1 LUFS**, peaks 0.76–0.96, no clipping; 36–63 s rendered in 12–26 s |
| Console | `tools/shoot.js` + `tools/qa.js` | **no exceptions** during load, playback, all five records, live tuning and export |
| Time to play | `node tools/qa.js` | first side playable **0.9–1.4 s** after navigation |

The MP3s in `audio/` were produced by the app's own export path, so what ships as
audio is what the code does.

## How I would ask to be judged

**Impact.** The intended user is a blind or low-vision person, a classroom, or a
museum floor. The build gives them a usable instrument rather than a video with
sound on top: keyboard-complete, screen-reader narrated, and honest about where
the data is missing.

**Creativity.** The mapping is the creative act, and it is unusually literal:
the record's own published colour bar becomes the pitch axis, so the legend the
scientists drew is the thing you hear. Reading a map left to right is heard as a
melody crossing the stereo field.

**Technical difficulty.** Pure-function analysis and composition separated from
the audio graph; the same graph used for playback and export; 230k pixel samples
per frame in ~8 ms; a live WMS path with CORS-safe canvas reads; an offline-first
build with no dependencies and no build step.

**Presentation.** One screen, no instructions needed: shelf, stage, transport,
meters, roll. The method page and liner notes carry the reasoning for anyone who
wants it.

## Known limits

- Five records, not six. Two candidates were rejected after inspection.
- Calibration is relative to each side (stated in the UI and exported in the
  score).
- Eighteen frames stand in for 39–217 s sequences; it is an interpretation of the
  arc, not a transcript.
- Speech synthesis quality depends on the browser and OS voice.
- No screen-reader or blind-participant testing was possible in this build; the
  ARIA follows the patterns but is not user-certified. This is the first thing to
  fix.
- Safari was not exercised.

## Provenance

Built for the 2026 NASA Space Apps Challenge challenge *The Earth Information
Jukebox*. Imagery: NASA Scientific Visualization Studio / Earth Information
Center content database; NASA Global Imagery Browse Services. All analysis,
composition and synthesis runs locally in the page. No sample libraries, no audio
files fetched, no external dependencies at runtime.
