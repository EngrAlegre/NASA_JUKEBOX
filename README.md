# The Earth Information Jukebox

**Five NASA records and a live frequency, read pixel by pixel and played as music.**

Built for the 2026 NASA Space Apps Challenge challenge *The Earth Information
Jukebox*. Pick a visualization of our changing planet, press play, and the same
data arrives through your eyes and your ears at the same moment.

No build step. No dependencies. No framework.

```bash
python tools/serve.py               # opens http://127.0.0.1:8177
```

Why a server at all: the app reads pixels out of a canvas, and browsers refuse to
expose pixel data for images loaded over `file://`. One stdlib command fixes it.
(If it is opened from disk, the app says exactly this instead of failing quietly.)

---

## The album

Five sides, one per sphere of the Earth system, all sampled from published NASA
visualizations.

| # | Record | Sphere | Source | 18 frames from |
|---|--------|--------|--------|----------------|
| 1 | **City Lights** | Human footprint | [SVS 5313](https://svs.gsfc.nasa.gov/5313/) · Black Marble / VIIRS, 2012–2023 | 43 s sequence |
| 2 | **Carbon Weather** | Atmosphere | [SVS 5196](https://svs.gsfc.nasa.gov/5196/) · DYAMOND CO₂, simulated Jan 2020 | 39 s sequence |
| 3 | **Canopy** | Biosphere | [SVS 4950](https://svs.gsfc.nasa.gov/4950/) · GEDI forest height | 51 s sequence |
| 4 | **Lightning** | Weather | [SVS 5011](https://svs.gsfc.nasa.gov/5011/) · ISS LIS, 2017–2023 | 217 s sequence |
| 5 | **Ocean Heat** | Ocean | [GIBS](https://gibs.earthdata.nasa.gov/) · GHRSST MUR sea surface temperature, last 18 days | 18 daily renders |

The first four come from the **Earth Information Center content database** (the
Scientific Visualization Studio gallery the EIC dashboards are built from). The
fifth is rendered from **NASA GIBS**, the same WMS the EIC uses for near-real-time
imagery — so one side is always current.

**The live tuner** is the sixth slot: point the same engine at today's sea
surface temperature, vegetation index, true colour or thermal anomalies, and it
builds a brand-new side from whatever the planet did in the last eighteen
frames. Nothing about the mapping is record-specific; the album is a
convenience, not a limit.

Listen without the app: [`audio/`](audio/) holds all five sides as MP3, rendered
by the same instrument through its own `OfflineAudioContext` export path.

---

## What happens to a frame

```
frame ──▶ measure ──▶ calibrate ──▶ compose ──▶ schedule ──▶ sound
   │         │            │            │           │
 pixels   features    within-side   one bar    Web Audio
                                                
```

1. **Fetch.** Frames are sampled evenly across the published sequence, skipping
   the first and last 6% so title cards and fades never become music. They are
   stored at 1280 px wide, so the page runs offline.
2. **Measure.** Every second pixel is read out of a canvas: luminance,
   saturation, circular-mean hue, Hasler–Süsstrunk colourfulness, position along
   the record's own published colour bar, a Sobel gradient field for texture, and
   two activity grids — sixteen vertical columns and six horizontal bands.
   About 230,000 samples per frame in roughly eight milliseconds.
3. **Calibrate.** Space is black. Night lights and aerosols both average under
   10% luminance, so absolute readings would put every record in the bottom
   octave. Each feature is stretched between its own 10th and 90th percentile
   *within the side*; raw values are still shown in the read-out and exported in
   the score. A side with no real variation falls back to a neutral centre rather
   than amplifying noise.
4. **Compose.** One bar per frame: a drone, a chord, a bass line, sixteen melodic
   steps, percussion, and transients for highlights.
5. **Schedule.** A Web Audio lookahead scheduler places events ~250 ms ahead of
   the clock, so the pulse stays steady while the page animates.

## The mapping

| Measured in the frame | Heard in the bar | Why |
|---|---|---|
| Mean luminance | Register (octave) | A luminous frame sings high, a dark one answers low. |
| Position along the colour bar | Scale degree | The legend becomes a pitch axis: its low end sits low in the scale, its high end sits high. |
| Colourfulness | Chord size (3 or 4 notes) | Saturated frames hold four notes; monochrome frames hold three. |
| Gradient texture | Subdivision, hat density | Busy texture earns sixteenths; smooth ocean holds long notes. |
| Six horizontal bands | Voicing spread | Activity across the full height opens the chord; one latitude band keeps it closed. |
| Change since previous frame | Tempo | The pulse quickens when the planet is visibly rearranging. |
| Sixteen vertical columns | Sixteen-step phrase | Reading the map left to right is heard as a melody crossing the stereo field. |
| Absolute texture per column | Note or rest | A black frame with faint noise has shape but no energy, so it stays quiet. |
| Horizontal centre of energy | Stereo position | Energy in the west leans left in the headphones. |
| Highlights (bright clusters) | Transients | City lights and lightning strikes are events, not textures. |
| Dominant hue | Timbre | Blue fields sound glassy, warm fields reedy. |
| Sensor coverage | Rest | Where the satellite saw nothing, the piece is silent. |
| *Position in the side* | *Arrangement arc* | *Artistic: intro, body, chorus, outro.* |
| *Bar index* | *Voicing inversion* | *Artistic: the chord rotates so a repeated degree does not stagnate.* |

The last two rows are composition rather than measurement and are marked as such
everywhere they appear. Everything above them is a reading of the frame's pixels.

### Two constraints that make it music rather than noise

- **Every pitch belongs to a fixed mode.** A measurement can choose any degree in
  the mode, never a note outside it — so extreme data cannot produce a wrong
  note. Extremes change register, density and timbre instead. There is a test for
  this (`tests/engine.test.js`) that walks every note of a side and asserts its
  interval against the scale.
- **Tempo glides at most 7 BPM per bar.** A jump reads as a mistake; a glide reads
  as the planet rearranging.

The mapping is deterministic: the same frame always yields the same bar.

## Accessibility

The premise of the challenge is that presenting Earth science visually excludes
people. Accessibility is therefore not a checkbox here — it is the argument.

- **A description of every bar, in words.** Generated from the same measurement
  vector that drives the music, so a blind listener and a sighted listener are
  told the same facts: *"Bar 7 of 18. The frame is bright, warm-leaning, and
  visually chaotic. Musically: 11 melodic notes, chord D3 F3 A3, tempo 96,
  chorus section."*
- **`aria-live` narration** while the side plays, plus a **Read this bar** button
  that speaks the current description through the browser's speech synthesis.
- **A real data table** is not needed to enjoy it, but every measured and composed
  value is in the exported score JSON, so the mapping can be audited line by line
  rather than trusted.
- **Full keyboard control**: space, arrows, digits 1–5, `D` describe, `A`
  auto-describe, `M` mute, `H` high contrast, `L` liner notes. Documented in a
  dialog reachable from the header.
- **High contrast theme**, `prefers-reduced-motion` honoured, visible focus rings,
  skip link, landmarks, and no information carried by colour alone — every meter
  has a number and a label.
- **The picture is optional.** Mute the sound and read; close your eyes and
  listen; do both. Neither channel is the "real" one.

## Export

- **WAV** — the whole side, rendered through `OfflineAudioContext` with the same
  graph as playback, so the file *is* the performance.
- **Score JSON** — every frame's raw measurements, calibrated values, composed bar,
  chord, note list and description. Machine-readable provenance for the mapping.

## Files

```
index.html              page structure, method, mapping table
styles.css              the deck
src/analyze.js          pixels -> measurements (pure, no DOM)
src/sonify.js           measurements -> bars -> audio (pure composition + graph)
src/app.js              state, scheduler, drawing, keyboard, export
src/records.js          musical settings per record; live layer list
src/gibs.js             WMS URLs and date series for the live tuner
data/records.json       generated catalog: frames, credits, datasets
data/records.js         the same catalog as a script, for offline use
data/records/<id>/      18 frames per record + cover
audio/                  the five sides as MP3 (rendered by the app itself)
tests/engine.test.js    59 assertions over analysis and composition
tools/build_library.py  rebuild the library from NASA SVS / GIBS
tools/render_sides.js   render every side to WAV through a real browser
tools/qa.js             accessibility tree, keyboard, export, reduced motion (18 checks)
tools/shoot.js          headless screenshots + console-error checks
tools/make_covers.py    pick each record's brightest frame as its sleeve
```

`analyze.js` and `sonify.js` deliberately avoid the DOM and Web Audio so the
mapping can be exercised outside a browser:

```bash
node tests/engine.test.js        # 59 checks, no dependencies
node tools/qa.js                 # 18 browser checks -> docs/qa-report.json
```

Full evidence, including what is *not* verified: [`docs/QA.md`](docs/QA.md).

## Rebuilding the library

```bash
python tools/build_library.py                 # everything missing
python tools/build_library.py --only ocean    # one record
node tools/render_sides.js                    # re-render the audio
```

Downloads are cached in `.cache/` and re-used, so a rebuild after editing the
catalog costs no bandwidth. FFmpeg and Pillow are needed to sample frames.

## Honest notes and limits

- **The album is five, not six.** Two candidate records from the EIC resource
  list were rejected after inspection, and the reasons are recorded in
  [`docs/DESIGN.md`](docs/DESIGN.md): the published sea-ice rendition is a black
  compositing matte, and the air-quality preview is a four-panel comparison reel
  whose frames are mosaics of unrelated pollutants. Padding the shelf with either
  would have looked better and meant less.
- **The mapping is a designed artefact, not a perceptual standard.** "Warm colour
  is high pitch" is a musical decision, not a law of psychoacoustics. It is
  documented, testable, and one line of code away from being changed.
- **The calibration is relative.** A bar tells you where a frame sits *within its
  own side*. It is deliberately not a claim that one record is brighter than
  another.
- **Frames are sampled, not streamed.** Eighteen frames stand in for sequences of
  39–217 seconds; the piece is an interpretation of the arc, not a transcript.
- **No real screen reader, and no blind participants.** The accessibility tree is
  verified programmatically (45 of 45 interactive nodes named, one `h1`, live
  regions present, `aria-current` on the playing bar); whether the experience is
  actually good for a screen-reader user is untested, and that is the honest gap.
- **Safari, Firefox and mobile hardware were not exercised.** See
  [`docs/QA.md`](docs/QA.md) §5 for the full list of what is and is not verified.

## Credits

Imagery: NASA Scientific Visualization Studio and the Earth Information Center
content database; live and daily frames from NASA Global Imagery Browse
Services. Real credits, dataset names and visualizer names for each side are in
the app's liner notes, parsed from the published SVS pages.

All analysis, composition and synthesis run locally in the page. No audio is
sampled, streamed or downloaded; every sound is generated by the graph in
`src/sonify.js`.

Built for the 2026 NASA Space Apps Challenge · The Earth Information Jukebox.
