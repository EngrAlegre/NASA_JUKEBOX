# Design notes: what was tried, what was rejected, and why

The challenge brief asks teams to document the *why* behind their artistic and
technical choices. This is that document. It is deliberately blunt about the
dead ends, because the dead ends are where the design actually got made.

---

## 1. Start from the data, not the concept

The obvious way to build "an Earth Jukebox" is to pick a nice animation, write a
mapping, and tune it until it sounds good. That produces a demo that breaks the
moment you point it at a different visualization.

So the unit of design here was not the app, it was **the measurement vector**: a
small, fixed set of numbers that any Earth frame can produce, in any palette, in
any projection, at any brightness. Every artistic decision had to be expressible
as a function of that vector. Anything that needed a special case for one record
was rejected or pushed into the record's own settings file.

The payoff is the live tuner: it is not a feature that was added, it is what
happened when nothing in the pipeline assumed a particular record.

## 2. Rejections

Four candidates from the challenge's own resource list were tried and dropped.
Each one is a decision, not an oversight.

| Candidate | What it actually is | Why it was rejected |
|---|---|---|
| **Sea ice** — *Perpetual Ocean 2*, SVS 5425 | The published `SEA_ICE_ONLY` rendition is an **alpha matte for compositing**, not a picture. Every sampled frame measured a mean luminance of 1/255. | A sonifier would have sung a beautiful piece about nothing. The beauty layers in that item are 1–5 GB renders, so the honest choice was to leave the sphere out of the static album and keep sea ice available in the live tuner instead. |
| **Air quality** — EIC preview, SVS 5533 | The published preview is a **four-panel comparison reel** (NO₂, O₃, CO, PM₂.₅) tiled twice across a 3840×1080 frame. | The mapping reads the map left to right. Across a mosaic, left-to-right is four unrelated chemicals, so the melody would have been a lie dressed as data. Cropping to one panel gave a 320×720 portrait strip, which is not a world map either. |
| **Cloud fraction** — GIBS `MODIS_Terra_Cloud_Fraction_Day` | A daytime-only composite in a garish red/purple palette, with wedge-shaped swath gaps and per-pixel speckle. | It measured fine and looked like a broken television. Sonification inherits whatever the image says; a palette that ugly makes the music feel arbitrary. |
| **Aerosol optical depth** — GIBS `MODIS_Terra_Aerosol` | 10% coverage, diagonal overpass swaths. | Sparsest dataset of the set, and the coverage is an artefact of orbital geometry rather than of the atmosphere. |

The lesson for a competition build: **the resource list is a menu of what is
available, not a specification of what is usable.** Two of the four named
resources that looked most promising were unusable as published, for reasons that
only appear when you actually decode the frames.

## 3. The bug the narration caught

The first build described a nearly-black night-lights frame as containing
**sixteen melodic notes**.

The audio did not reveal this. A quiet frame with faint noise still has a
*shape* — slightly more gradient here than there — and the sixteen columns were
normalised against their own maximum, so every column read as "busy". The music
was plausible; the sentence was obviously false.

The fix was to keep two views of the same grid:

- **relative** (`bands`) — each frame's own contour, which gives the melody its
  shape;
- **absolute** (`bandsAbs`) — measured against a fixed gradient scale, which
  tells you whether there is any energy at all.

Notes are gated on absolute energy and pitched by relative contour. A black frame
now writes eight notes or none, and there is a unit test asserting that a solid
black frame produces zero melodic notes.

Two generalisable conclusions:

1. **A text description is a test.** If you can generate language from your
   measurement pipeline, read it — it catches category errors that listening
   forgives.
2. **Normalising per-frame is a trap.** Any feature that is rescaled to fill
   0–1 will eventually describe silence as activity.

## 4. Calibration: the decision that made the album possible

Space is black. Measured absolutely:

| Record | Mean luminance of sampled frames |
|---|---|
| City Lights | 0.035 – 0.049 |
| Carbon Weather | 0.026 – 0.045 |
| Lightning | 0.044 – 0.130 |
| Canopy | 0.12 – 0.13 |

Using those numbers directly would put every record in the lowest octave and make
"brightness" meaningless — the planet is a small bright thing in a large dark
frame.

So each feature is stretched between its own 10th and 90th percentile **within
the side**, and the raw value is kept for display and export. This is a real
interpretive choice, and it is stated in the UI: *values are scaled within this
side, not across all records*. A bar tells you where a frame sits in its own
sequence; it is not a claim that one visualization is brighter than another.

A side with no genuine variation (span < 0.012) falls back to a neutral centre
rather than amplifying sensor noise into a melody.

## 5. Why eighteen scenes, and why one bar each

- **Eighteen** is the most that can be sampled evenly from a 39-second sequence
  at ~2 s spacing while still skipping intros and fades, and the fewest that can
  carry an arrangement with an intro, a body, a chorus and an outro. It also fits
  a filmstrip across a laptop without scrolling.
- **One frame, one bar** is the core promise of the piece: the picture changes,
  the music changes, at the same instant. Subdividing a frame across two bars
  would break the simultaneity that makes the thing legible.
- **Sixteen melodic steps** line up with sixteen columns of the map, so the
  piano roll and the image sweep left to right together. Watching the two is the
  clearest explanation of the mapping that exists — better than the table.

## 6. Offline first, live second

Judges, museums and classrooms have unreliable networks. The album therefore
ships its frames and its catalog as a plain script (`data/records.js`), so the
page needs no fetch, no CDN, no API key and no build step to show a side. The
live tuner is the exception and is clearly labelled as such: it needs NASA GIBS,
and says so when it cannot reach it.

One correction to an early assumption: `file://` does *not* work, and the reason
is worth recording. The app reads pixels out of a canvas, and Chrome treats every
image on a `file://` page as cross-origin, so `getImageData` throws no matter how
the image is loaded. The first version of this page claimed "just open
index.html"; the test suite caught it (`tools/shoot.js` over a `file://` URL) and
the claim was removed rather than shipped. A three-line `http.server` wrapper now
does the job, and the app detects `file://` and says what to do instead of
failing quietly.

This is also why GIBS was such a good find: it sends
`Access-Control-Allow-Origin: *`, which means a page can read WMS pixels with a
canvas without any proxy. Most NASA services do not allow that.

## 7. Audio engineering decisions

| Decision | Reason |
|---|---|
| Lookahead scheduler (250 ms horizon, 40 ms tick) | `setTimeout` jitter is audible; scheduling against `AudioContext.currentTime` is not. |
| Tempo clamped to ±7 BPM per bar | Without the clamp a single busy frame jumped the pulse by 21 BPM and sounded like a mistake. |
| All pitches from a fixed mode | Guarantees consonance regardless of data, and makes the result *auditable*: a test asserts every note's interval against the scale. |
| Same graph for playback and export | `createEngine(ctx)` takes any `BaseAudioContext`, so the WAV is the performance rather than a second implementation that drifts. |
| One mix trim (2.5×) before the limiter | The voices are written at polite per-event gains; the first master was 8 dB too quiet (measured −25 LUFS). Now −16.9 to −19.1 LUFS across the album. |
| Synthetic impulse response, no binary assets | Reverb without shipping an audio file, and identical in the offline render. |
| Silence where coverage is zero | The mapping's honesty clause: no sensor, no sound. |

Render cost, measured on a mid-range laptop: analysis ~8 ms per frame,
composition 1–3 ms per side, offline render 12–26 s for 36–63 s of audio. The
WAV export therefore shows a progress state rather than pretending to be
instant.

## 8. Making it musical without ears in the room

The riskiest part of this project is not technical. Generative music built from
coarse image statistics very easily sounds like a synthesiser demonstration: a
pad, a pulse, and some notes that happen to be in key. Three specific problems
were fixed after the first render, none of which any test could have caught,
because they are musical judgements rather than correctness bugs.

**1. The harmony teleported.** Colour position chose the chord degree outright,
so a frame whose average colour shifted fast could move the chord six scale steps
between one bar and the next. Every individual chord was legal; the sequence was
not music. The fix is the same shape as the tempo clamp: the colour bar now
names a *target*, and the chord walks toward it one step per bar, two in a
chorus. The data still decides where the harmony goes; the music decides how fast
it gets there. A test asserts the step size.

**2. The grid was machine-quantised.** Sixteen melody steps landed exactly on
their subdivisions with identical velocities. That is what a spreadsheet would
sound like. Notes now carry a few milliseconds of timing scatter and ±14% of
velocity, seeded by the bar index so exports stay byte-identical.

**3. The "inversion" was a no-op.** The chord was rotated across its own array —
which changes only the order, and therefore only which pan position each pitch
received. Pitches were identical between an "inverted" bar and a plain one. It is
now a real inversion (the lowest tones lift an octave), and a test compares the
two chords and fails if they match.

What that leaves unverified is taste. The mix was measured — −16.4 to −19.1 LUFS,
peaks 0.76–0.96, per-bar RMS arcs, log-scale spectrograms showing harmonic
structure rather than noise — but nobody has listened critically in this
environment. Measuring a mix is not hearing it.

## 9. What was deliberately not built

- **A "data fidelity vs musicality" slider.** It sounds generous and is actually
  an abdication: the interesting work is choosing the constraints, and exposing
  them as a knob would let the piece be bad without anyone being responsible.
- **Machine learning.** With eighteen frames per side and no labelled training
  data, a learned mapping would have added a dependency and removed the ability
  to explain a single note. The mapping is arithmetic, and every number is
  inspectable.
- **A separate backend.** The whole instrument is about 2,100 lines of browser code.
  A server would have added nothing but a failure mode.
- **Six records for the sake of six.** See §2.

## 10. If there were another day

1. **Frame-level provenance.** Frames are sampled at known timecodes; storing the
   exact frame number from the SVS `frames/` directory would let anyone rebuild
   the identical bar from the original PNG rather than from a re-encoded video.
2. **A screen-reader-only data table per side.** The score JSON exists; a live
   `<table>` would let a blind user read the whole side's measurements in the app.
3. **Haptics.** The challenge mentions tactile feedback; Android's `Vibration` API
   could carry the kick pattern on phones.
4. **MIDI export**, for musicians who want to take the mapping into a DAW.
5. **A perceptual study.** Does a listener actually hear "warm = high"? The design
   asserts it; measuring it would be the honest next step.
