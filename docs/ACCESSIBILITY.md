# Accessibility

The challenge exists because Earth science is presented almost entirely through
images, and that excludes people. So the accessibility work here is not a feature
list bolted onto a demo — it is the argument for the whole project.

The design position: **neither channel is the real one.** A sighted listener can
mute the sound and read; a blind listener can ignore the picture and listen; both
can do both. Nothing essential lives in only one modality.

---

## What is in the build

### Language, generated from the same numbers as the music

Every bar has a description produced from its measurement vector, not written by
hand:

> *Bar 7 of 18 of City Lights. The frame is mid-toned, warm-leaning, saturated
> across the spectrum, and visually chaotic. Energy concentrates in the east, and
> much of the frame is in shadow. Musically: 11 melodic notes, chord D3 F3 A3,
> tempo 96, chorus section.*

Because both the sentence and the sound read the same vector, the two channels
cannot disagree. A listener who hears eleven notes hears a sentence that says
eleven.

### Speech

- **Read this bar** (`D`) speaks the current description through the browser's
  speech synthesis.
- **Auto-describe** (`A`) speaks a short description at each bar boundary while
  the side plays — a running commentary of the piece.
- Narration is also delivered to a polite `aria-live` region, so screen-reader
  users get bar changes without the speech synthesiser fighting their own reader.

### Keyboard

Everything works without a pointer. Documented in a dialog reachable from the
header (`Keys`) and summarised in the page.

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Previous / next bar |
| `↑` `↓` | Previous / next record |
| `1`–`5` | Choose a record |
| `D` | Describe the current bar aloud |
| `A` | Toggle auto-describe |
| `M` | Mute |
| `H` | High contrast |
| `L` | Liner notes |
| `Esc` | Close any panel |

### Structure and semantics

- Skip link to the instrument; one `<h1>`; each region labelled by its heading.
- Records are a real `role="list"` of `<button aria-pressed>` — the selected
  record is exposed as pressed, not as a CSS class.
- The filmstrip is an ordered list of buttons, each labelled
  *"Bar 4 of 18: blazing, hot end of the palette, gently textured"*, and the
  current bar is marked `aria-current="true"`.
- The stage canvas is `role="img"` with its accessible name pointing at the
  generated description, so it is never an unlabelled graphic.
- Meters are rows of label + value; the bar graphic inside is `role="img"` with a
  percentage in its label, and the mapped value is written in text next to it.
  **No information is carried by colour alone.**
- The transport uses `aria-pressed` on the play button (not a changing icon
  alone), and the loop toggle reflects state the same way.

### Visual

- **High contrast theme** (`H`): pure black, 2× borders, brighter ink, all accents
  lightened to stay above 4.5:1.
- **`prefers-reduced-motion`** disables transitions and the roll's animation.
- Focus is always visible: a 2 px amber ring with 3 px offset on every
  interactive element, including inside the transport's circular controls.
- Body text is 15 px minimum; the smallest text in the interface is 10.5 px
  monospace metadata, which is decorative rather than load-bearing.
- Type scale, spacing and contrast were checked at 400 px, 900 px, 1180 px and
  1600 px widths.

### The honest-data clause

Where a sensor saw nothing, the piece is **silent** rather than filling in. That
is an accessibility decision as much as a scientific one: a listener is told the
truth about coverage, and a missing swath is audible as a rest rather than
disguised as sound.

---

## What was tested, and what was not

Verified in a real browser (headless Chromium over the DevTools Protocol, no
test framework) by `node tools/qa.js` — 18 checks, all passing:

- **Accessibility tree**: 45 of 45 interactive nodes carry an accessible name;
  exactly one `h1`; two live regions; the stage canvas is labelled by the
  generated description; the playing bar carries `aria-current`, the selected
  record `aria-pressed`; all six meters expose their values as text.
- **Keyboard**: 45 distinct Tab stops; space starts playback; arrows step bars;
  contrast, liner notes and the keys dialog all reachable.
- **Export**: the real button produces a valid 52.7 s, 44.1 kHz stereo WAV.
- **Reduced motion**: reloaded with `prefers-reduced-motion: reduce` emulated, the
  score still draws and the side still loads, with no exceptions.
- **Timing**: first side playable 0.9–1.4 s after navigation.

Separately, `node tests/engine.test.js` runs 59 assertions over analysis and
composition, and layout was checked at 400 × 860 and 1600 × 1200.

**Not verified, and stated as a limitation:** no test with an actual screen
reader (NVDA/JAWS/VoiceOver) was run, and no listening test with blind or
low-vision participants was conducted. The tree check proves names and roles
exist and are wired; it does not prove the reading order is pleasant, or that
announcements are not too chatty during a dense passage. The ARIA is written
against the WAI-ARIA practices, not certified by users — which is the honest
status of a weekend build, and the first thing to fix next.

Full evidence, including the negative results: [`QA.md`](QA.md).

---

## Why this matters to the judging criteria

The challenge asks for accessibility as a *core theme*, not a compliance badge.
The strongest thing this build can say is that a blind user is not given a
second-class version of the visualization: they are given the same measurements,
in a modality that carries them better. The description is not a summary of the
picture — it is the picture, spoken.
