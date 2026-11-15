# The submission deck

Six slides, 16:9, built by `tools/build_deck.py`. The challenge allows a video or
a 7-slide deck; this is deliberately six — one idea per slide, no bullet walls.

Output: `Five-Sides-deck.pptx` in the project root.

## Rebuilding it

The deck is generated, not hand-edited. Editing the `.pptx` directly and then
re-running the builder throws the edits away, so change the builder instead.

```bash
# 1. screenshots of the running app (starts and stops its own server)
python tools/capture_shots.py

# 2. frames from the record clips, for the full-bleed slides
ffmpeg -y -ss 8  -i data/motion/lightning.mp4 -frames:v 1 .cache/deck/title.png
ffmpeg -y -ss 12 -i data/motion/canopy.mp4    -frames:v 1 .cache/deck/canopy.png
ffmpeg -y -ss 15 -i data/motion/ocean.mp4     -frames:v 1 .cache/deck/ocean.png
ffmpeg -y -ss 5.5  -i data/motion/co2.mp4     -frames:v 1 .cache/deck/move1.png
ffmpeg -y -ss 9.5  -i data/motion/co2.mp4     -frames:v 1 .cache/deck/move2.png

# 3. build, and render every slide to PNG for review
python tools/build_deck.py --png
```

Rendering uses the PowerPoint COM interface if PowerPoint is installed
(`.cache/deck-render/slideN.png`). There is no pure-Python renderer; if
PowerPoint is absent, review the outline with `pptx_read.py` instead and say so
rather than claiming the slides were checked.

## Slide order

| # | Kicker | Argument |
|---|---|---|
| 1 | — | Title. Name, one-line description, team, site. |
| 2 | 01 · The problem | Earth science arrives as pictures, and a still cannot say "it is getting brighter". |
| 3 | 02 · The idea | Measurements become music — luminance→octave, colour bar→pitch, texture→density, change→tempo. |
| 4 | 03 · How it works | Five steps, and four numbers that can be checked. |
| 5 | 04 · It moves | Two frames of one scene, 4 s apart, and the bar they produced. |
| 6 | 05 · Who it is for | Spoken description, keyboard, reduced motion; links and the non-endorsement line. |

Every slide carries speaker notes — the deck doubles as the talk track, so the
video script (`docs/DEMO_SCRIPT.md`) and the deck say the same things.

## Design system

Pulled from the app so the deck and the product look like one thing.

- Ground `#07080B`, text `#F2F5F8`, muted `#8B93A3`, hairline `#23262E`
- One cyan accent `#63DBE4`, one amber accent `#FFB648` — amber is reserved for
  the numbers and the single strongest line on a slide
- Segoe UI Semibold for headlines, Segoe UI for body, Consolas for labels and
  numbers (with letter-spacing)
- Margins 0.85 in, footer rule at 6.86 in, slide number right-aligned

## Two traps found the hard way

**Element order in `spPr`.** A gradient fill appended after `<a:ln>` produces a
file python-pptx writes and re-reads happily, and PowerPoint refuses to open
("PowerPoint could not open the file"). Fills must be inserted before the line.

**Negative extents.** A textbox whose computed width goes negative (a caption
column that does not fit) is written as a negative `ext cx`, and PowerPoint
again refuses to open the file without naming a shape. `check_geometry()` now
fails the build and names the slide and shape.
