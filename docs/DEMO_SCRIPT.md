# Demo video script

The challenge takes a **30-second video** (unlisted YouTube) *or* a 7-slide deck.
The 30-second cut is the submission; the longer cut is for anyone who clicks
through from the gallery.

Every version follows the five beats the submission form asks for: introduce
yourself, lead us in, name your project, describe your idea, look into the
future.

Record at 1600×900 or larger, browser at 100% zoom, bookmarks bar hidden. Start
the video **already inside the app** — the first three seconds decide whether
anyone watches the rest.

---

## The 30-second cut (the one you submit)

72 spoken words. At a natural pace that is under 30 seconds. Do not read it faster to
fit; cut a sentence instead (see *If you run long*).

| Time | Beat | What is on screen | Voice |
|---|---|---|---|
| 0:00–0:03 | **Introduce yourself** | The app already playing *City Lights*. Cursor off frame. Map drifting, playhead sweeping. | "I'm [your name], from One Man vs All." |
| 0:03–0:09 | **Lead us in** | Same shot, let the map move. The 2020 label ticks over. | "NASA's Earth Information Center makes the best pictures of Earth. Nobody can hear them." |
| 0:09–0:13 | **Name your project** | Cut wide to the shelf — all five covers — then back to the stage. | "Five Sides: five NASA records, played pixel by pixel." |
| 0:13–0:24 | **Describe your idea** | Meters pulsing with the music. At 0:17 press **D** and let the app speak one description. At 0:21 press **4** to jump to *Lightning*. | "Every scene is measured — brightness, colour, texture — that becomes the music. The legend's colour bar sets the pitch: warm water sings high, empty sky stays silent." |
| 0:24–0:30 | **Look into the future** | *Lightning* playing, percussion visible in the spectrum. Live tuner panel in frame, not loading. Hold on the stage, cursor still. | "Five records, a live tuner for today's Earth. Look at it — or listen to it." |

**72 spoken words.** At 150 words a minute that is 28.8 seconds — short enough to
leave the pause after "silent" that makes the next line land. Read it at a normal
pace; do not rush it.

### If you run long

Cut in this order, and nothing else:

1. "warm water sings high, empty sky stays silent" (−8 words, −3 s)
2. The shelf cutaway — stay on the stage through 0:09 (−2 s)
3. "Nobody can hear them." (−4 words, −1.5 s)

Never cut the closing line. It is the only sentence that says what the thing is
*for*.

---

## The 75-second cut (for judges who click through)

Same opening three beats, then room to breathe.

**0:00–0:12 · Hook** — *City Lights* playing. Let a full bar pass so the music
establishes itself before you speak.
> "This is eleven years of city lights. It is also a piece of music. Every scene
> you can see moving has been measured, and what you are hearing is what those
> measurements became."

**0:12–0:28 · The mapping** — hover the meters as each one moves; point at the
colour bar in the liner notes.
> "Twelve things are measured in every frame. Brightness picks the octave.
> Position along the record's own colour bar — the legend the scientists drew —
> picks the scale degree. Texture decides how fast the notes come, and how much
> the planet changed since the last scene sets the tempo."

**0:28–0:38 · The picture moves with the music** — press `→` twice, slowly.
> "Each bar plays its own scene, slowed to the length of the bar, so the maps
> drift rather than jump. The strip under the stage is the sound itself, tapped
> off the audio bus."

**0:38–0:52 · Why it exists** — press **D**; let the synthesiser read one
description. Turn the music down slightly under it.
> "Every bar can say what it is, in words, from the same numbers. A blind
> listener is not handed a summary of the image — they are handed the same
> measurements, in the modality that carries them better."

**0:52–1:04 · Same instrument, different planet** — press **3**, **4**, **5** to jump
between records (↓ steps to the next one).
> "Nothing here is tuned to one record. Lightning is percussion first, because a
> record made of transients should be. Canopy is bright and open, because tall
> forest sits at the bright end of its own scale."

**1:04–1:15 · Close** — back to *Lightning* playing; leave the tuner panel
visible.
> "Five records from NASA's Earth Information Center, one live from GIBS, and a
> tuner that writes a new side from today's planet. Look at the Earth — or listen
> to it."

---

## The 7-slide deck (if you prefer no video)

Seven slides, one idea each, no walls of text. Put the deck on the same unlisted
link and submit that instead.

1. **Title** — Five Sides. One line: *NASA Earth Information Center animations, played as music.* Your name, One Man vs All, Manila.
2. **The problem** — one EIC still, full bleed. Caption: *This is how Earth science usually arrives. If you cannot see it, you do not get it.*
3. **The idea** — the mapping table from the Method section, three rows only: measurement → musical parameter → why.
4. **How it works** — the five-step pipeline as a single horizontal diagram: fetch, measure, calibrate, compose, play. One sentence per step.
5. **It moves** — two frames of the same scene, four seconds apart, with the bar it produced. Caption: *Each bar plays the scene it was measured from.*
6. **It is for people who cannot see it** — a screenshot of a spoken description next to the same bar's music. Caption: *The picture is optional. The description never is.*
7. **Links** — fivesides.site, GitHub, and the honest line: *NASA does not endorse this project.*

---

## Recording checklist

- **Window:** 1600×900 or 1920×1080, browser zoom 100%, bookmarks bar hidden,
  one tab only. Close DevTools — a console in frame reads as a bug.
- **Audio capture:** the music is Web Audio, so it goes through the system mixer.
  In OBS use *Desktop Audio* (WASAPI output capture). Test with a 5-second
  recording: if the music is missing, you captured the microphone only.
- **Levels:** voice peaking around −12 dB, music sitting roughly 8–10 dB under
  it. The app's own volume slider is the easiest place to set that — put it near
  60% and record the voice separately if you can.
- **One take is enough.** Do not stop for a wrong word; the voice is under 80
  words and nobody is grading your delivery. Re-record only if the music did not
  start.
- **Do not press Tab** during recording — the skip link gets a focus ring and it
  looks like a bug.
- **Move the cursor deliberately**, stop before clicking, and park it away from
  text before you stop talking.
- **End on a clean frame** with the music still playing; trim the tail in the
  editor rather than fading out.

## Keys you will actually use

| Key | Does |
|---|---|
| `Space` | play / pause |
| `1`–`5` | jump to a record: 1 City Lights, 2 Carbon Weather, 3 Canopy, 4 Lightning, 5 Ocean Heat |
| `↓` / `↑` | next / previous record |
| `→` / `←` | next / previous **scene** inside the current record |
| `D` | speak the current bar's description aloud |
| `H` | high contrast |
| `M` | mute |

`→` moves between scenes, **not** between records. Use `4` when the script says
"go to Lightning".

## Facts to keep straight while talking

- Five records, not four: City Lights, Carbon Weather, Canopy, Lightning, Ocean
  Heat.
- Every side is **eighteen scenes / eighteen bars**. The video shows eighteen,
  never "dozens".
- The music is generated live in the browser — there is no recorded soundtrack
  playing underneath.
- The live tuner is not a video: it fetches renders from NASA GIBS at play time
  and may take a few seconds on a slow connection. Do not wait for it on camera.
