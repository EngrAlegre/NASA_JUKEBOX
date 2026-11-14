# Demo video script

Two minutes. Screen recording plus voice-over. No face needed, no cutaways.

Record at 1600×900 or larger, with the browser at 100% zoom. Start the video
**already on the app**, not on a title card — the first three seconds decide
whether anyone watches the rest.

---

## 0:00 – 0:12 · Hook

**Screen:** The app, idle on *City Lights*. Cursor moves to Play and clicks.
The playhead sweeps; the piano roll fills.

**Voice:**
> This is a map of eleven years of city lights. It is also a piece of music. Every
> frame of it was measured, and what you are hearing is what those measurements
> became — at the same moment you see them.

**On-screen text:** *The Earth Information Jukebox — NASA EIC frames, played as sound*

## 0:12 – 0:35 · The mapping, made visible

**Screen:** Slow, deliberate. Hover the meters as each one moves. Then point at
the filmstrip thumbnails.

**Voice:**
> Twelve things get measured in every frame. Brightness picks the octave. Where
> the average colour sits on the record's own colour bar — the legend the
> scientists drew — picks the scale degree, so cool is low and warm is high.
> Texture picks how fast the notes come. How much the planet changed since the
> last frame picks the tempo.
>
> The sixteen columns of the map become sixteen melodic steps, read left to
> right, so the melody crosses the stereo field as it crosses the map.

**Screen:** Press `D`. The description appears, and the voice synthesiser reads
it. Let it speak for four or five seconds, then cut.

**Voice:**
> And every bar can say what it is, in words, from the same numbers.

## 0:35 – 1:00 · Why it matters

**Screen:** Turn the sound down. Click through liner notes; show the keyboard
dialog; press `H` for high contrast.

**Voice:**
> The reason this exists is that Earth science is almost all pictures, and
> pictures leave people out. So nothing here lives in only one channel. Every
> control is on the keyboard. Every bar can be read aloud as it plays. The whole
> thing works in high contrast, and it respects reduced motion.
>
> A blind listener is not given a summary of the image. They are given the same
> measurements, in the modality that carries them better.

## 1:00 – 1:25 · Same instrument, different planet

**Screen:** Arrow keys to *Lightning* — it is audibly different, percussive. Then
*Canopy*, bright and open. Then *Ocean Heat*.

**Voice:**
> Nothing about the instrument is tuned to one record. Lightning is percussion
> first, because a record made of transients should be. Canopy is bright and open,
> because tall forest sits at the bright end of its colour bar. And Ocean Heat was
> built this morning from the last eighteen days of sea surface temperature.

**Screen:** Open the live tuner, choose Sea Surface Temperature, click Tune in,
let the new side appear.

**Voice:**
> Point it at today's planet and it writes a new side.

## 1:25 – 1:45 · The engineering

**Screen:** Scroll to the Method section. Highlight the two rows marked *artistic*.
Then a terminal: `node tests/engine.test.js` → 59 checks passed.

**Voice:**
> Two constraints keep eighteen bars of satellite data listenable: every pitch is
> drawn from a fixed mode, so no measurement can produce a wrong note, and tempo
> can only move seven BPM per bar. Both are enforced in code, and both are tested.
>
> The composition is a pure function — frames in, bars out — and the same audio
> graph renders live playback and the exported WAV, so the file is the
> performance.

## 1:45 – 2:00 · Close

**Screen:** Click Export WAV; the progress state; the file appears. Then back to
the stage, playing.

**Voice:**
> Four records from NASA's Earth Information Center, one from GIBS, and a live
> tuner. No build step, no dependencies, no framework — one command serves the
> folder and it runs.
>
> The Earth Information Jukebox. You can look at the planet, or you can listen to
> it.

**On-screen text:** *github.com/… · open index.html*

---

## Cut-down versions

**30 seconds (for the challenge gallery):** Hook (0:00–0:08) → press `D` and let
the description speak over the music (0:08–0:18) → arrow to Lightning, one
sentence about the mapping (0:18–0:26) → close line (0:26–0:30).

**15 seconds (social):** Start mid-piece on Lightning, cut to the meters moving,
one caption: *"Every pixel measured. Every frame a bar. NASA's Earth Information
Center, played back as music."*

## Production notes

- Use the **Lightning** side for any silent-autoplay context: it reads as music
  even at low volume, and it is the shortest at 37 s.
- Keep the meters in frame whenever music is playing — they are the argument.
- Do not put music under the voice during 0:12–0:35; the mapping explanation
  needs to be heard against silence, with only the app's own sound.
- If recording a screen reader demo, use NVDA on Windows and slow the speech rate
  to ~50%; the bar announcements are short but frequent.
