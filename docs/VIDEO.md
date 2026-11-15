# The demo videos

Two cuts, both generated rather than hand-edited, so either can be rebuilt when
the app changes.

| File | Length | Use |
|---|---|---|
| `Five-Sides-demo.mp4` | 28.7 s | the submission candidate — the challenge accepts a 30-second video or a 7-slide deck |
| `Five-Sides-demo-60s.mp4` | 57.2 s | the feature reel: every record, plus the keyboard map, the honesty switch and export |

The long cut is a montage of nine takes:

| Segment | Shows |
|---|---|
| title | name, team, site |
| Carbon Weather | motion, spectrum, live measurement readout |
| Canopy, Lightning, Ocean Heat, City Lights | four more records, each audibly different |
| keys | the keyboard map dialog — every control is reachable |
| source | `Show NASA frame`: every overlay off, raw pixels |
| export | `Export WAV` in its working state, beside the meters and piano roll |

Each segment is scored with the slice of that side's own audio matching the
frames on screen, so nothing is mimed.

## Rebuilding

```bash
# 1. capture the app playing (starts and stops its own server child)
python - <<'PY'
# two takes: the CO2 globe and the Lightning strikes
PY
node tools/record.js "http://127.0.0.1:8199/?r=co2"       .cache/vid/a 16 --play
node tools/record.js "http://127.0.0.1:8199/?r=lightning" .cache/vid/b 12 --play

# 2. cut, caption, score and encode
python tools/build_video.py
```

`record.js` writes `frame-*.jpg` plus `timing.json` — every frame carries the
wall-clock millisecond it was taken, because the capture rate wanders between 14
and 27 fps and a fixed frame rate would drift the sound away from the picture.
`build_video.py` resamples onto a 30 fps timeline using those timings, so the
picture runs at true speed.

## Structure

| Time | What | Audio |
|---|---|---|
| 0:00–0:02 | Title card | silence |
| 0:02–0:16 | Carbon Weather, playing | `audio/co2.mp3` from the capture's offset |
| 0:16–0:26 | Lightning, playing | `audio/lightning.mp3` from its offset |
| 0:26–0:29 | End card | silence |

The soundtrack is each side's own rendered audio — the same engine that draws
the picture produced it — entered at the playback position the capture started
from, so what you hear is what the screen was doing.

Captions are a lower third: a band with a cyan hairline. Loose text at the bottom
of the frame landed on the app's own labels and read as a rendering fault.

## Three more, from the long cut

**The caption band was hiding its own subject.** The export control sits in the
bottom-right corner, exactly where a lower third goes, so the beat described a
button nobody could see. The take now scrolls the control up before clicking it.

**`--actions` never ran.** The hook parsed the argument but the block that should
have used it was inserted against stale anchor text, so three takes silently
captured an untouched page. Every take is now checked for the visual change it
claims, not just for playback.

**An 84%-opaque band let page text bleed through.** At 1080p the words behind it
were legible, which reads as a compositing fault. The band is now opaque.

## And four original ones

**A scripted click is not a user gesture.** `document.querySelector(...).click()`
runs `play()`, but the AudioContext stays suspended, so the transport never
advances and the "video" is a single frozen frame. The recorder resumes the
context explicitly and then *verifies* `state.playing` rather than assuming.

**Never click play twice.** The control is a toggle. An early version retried the
click when the clock text still read `0:00`, which paused the take seconds in.
Every take now checks `state.playing` before retrying, and retries at most once.

**Screencast frames must be acknowledged on the page session.** `Page.screencastFrameAck`
sent on the browser session stalls the stream after one or two frames (0.19 fps).
With the ack routed to the page session the same page yields 27 fps.

**The app pauses itself when the tab reports itself hidden** — correct for a
listener who switches tabs, fatal for a recording. The recorder asks Chrome for
focus emulation and shims `document.hidden` for the duration of the take.

## Checks

Every take records, and the build fails loudly on:

- `state.playing` false at any sample (frozen picture)
- the audio clock advancing slower than wall clock (throttled renderer)
- `document.hidden` flip-flopping (self-pause)
- transport clock identical at start and end

The finished file is verified with `ffprobe` (duration, codec, resolution) and
`volumedetect` (music present, title card silent), and frames are pulled at six
timestamps and inspected.
