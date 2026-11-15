"""Fill the Space Apps submission template with the Five Sides entry.

Keeps the template's own styles and section order: every Heading 1 / Heading 2
paragraph stays where the form puts it, the front-matter fields are filled, and
the BioSeeker "Draft for final" tail is replaced by the final content.
"""
import copy
import shutil

from docx import Document
from docx.oxml.ns import qn

SRC = "NASA-paper.docx"
OUT = "NASA-paper-final.docx"

shutil.copyfile(SRC, OUT)
doc = Document(OUT)
paras = doc.paragraphs

# The marker for where the draft begins. Anchored by element, not index: every
# insertion below shifts the indices that follow it.
marker_el = next(
    p for p in doc.paragraphs
    if p.text.strip().lower().startswith("draft for final")
)._p


# ---------------------------------------------------------------- helpers
def strip_runs(p):
    for r in list(p.runs):
        r._element.getparent().remove(r._element)


def set_text(p, text):
    """Replace a paragraph's text, keeping its style and its properties.

    Clears every child except <w:pPr>, because some of the template's paragraphs
    keep their text inside <w:hyperlink> elements — python-docx's .runs does not
    see those, so a naive 'edit runs[0]' appended to the link instead of
    replacing it.
    """
    pPr = p._p.find(qn("w:pPr"))
    for child in list(p._p):
        if child is not pPr:
            p._p.remove(child)
    p.add_run(text)


def set_runs(p, parts):
    """parts = [(text, bold), ...] rebuilt inside the paragraph's own style."""
    strip_runs(p)
    for text, bold in parts:
        r = p.add_run(text)
        if bold:
            r.bold = True


def insert_after(anchor_p, text, style):
    new = doc.add_paragraph(text, style=style)
    anchor_p._p.addnext(new._p)
    return new


def clone_after(anchor_p, text):
    """Duplicate a paragraph (same style) right after it, with new text."""
    el = copy.deepcopy(anchor_p._p)
    anchor_p._p.addnext(el)
    p = doc.paragraphs[list(doc.paragraphs).index(anchor_p) + 1] if False else None
    # build a Paragraph wrapper for the new element
    from docx.text.paragraph import Paragraph
    p = Paragraph(el, anchor_p._parent)
    set_text(p, text)
    return p


body_style = paras[58].style          # the template's own body style
h1 = paras[0].style                   # Heading 1
h2 = paras[1].style                   # Heading 2

# ------------------------------------------------------- front matter
set_text(paras[1], "Project Name")                       # keep heading text
name_p = insert_after(paras[1], "Five Sides", body_style)

set_text(paras[3],
    "Five Sides is a browser instrument that plays NASA Earth Information Center "
    "animations as music. Eighteen scenes are taken from each animation, measured "
    "pixel by pixel, and played one per bar, so the same data arrives through the "
    "eyes and the ears at the same instant — and the picture keeps moving inside the "
    "bar rather than sitting still behind it. It ships five "
    "records — city lights, atmospheric carbon dioxide, forest canopy height, "
    "lightning seen from the International Space Station, and sea surface "
    "temperature — plus a live tuner that builds a new side from the last eighteen "
    "days of NASA imagery. Every sound is generated in the page from a measurement "
    "of the pixels; every bar can describe itself in words for listeners who cannot "
    "see it. Built for blind and low-vision listeners first, and for everyone else."
)

# Project Demonstration link
set_text(paras[8],
    "Link: 30-second demo video (Five-Sides-demo.mp4) — "
    "https://github.com/EngrAlegre/NASA_JUKEBOX/blob/main/Five-Sides-demo.mp4 — "
    "with the six-slide deck (Five-Sides-deck.pptx) in the same repository."
)

# Project application link
set_text(paras[12], "Link: https://www.fivesides.site/")

# Project details
set_text(paras[17],
    "Team One Man vs All (solo entry; Local Event: Manila, Philippines). Challenge: "
    "The Earth Information Jukebox. Five Sides is a single-page web application — "
    "HTML, CSS and plain JavaScript, no framework and no build step — that runs "
    "entirely in the browser. It is neither a recorded film nor a set of stills: the "
    "published NASA animation is decoded and drawn into the page frame by frame, and "
    "the music is synthesised live from measurements of those same frames, so the "
    "picture keeps moving inside the bar. The measured scenes ship with each record "
    "so the side plays offline; the live tuner requests fresh frames from NASA GIBS. "
    "Source and documentation: https://github.com/EngrAlegre/NASA_JUKEBOX"
)

# NASA data: six sources, so the four template rows become six
link_texts = [
    "Earth Information Center content database (NASA Scientific Visualization Studio gallery)",
    "Change in Night Lights between 2012 and 2023 — EIC Version (SVS 5313)",
    "DYAMOND Global Carbon Dioxide (SVS 5196)",
    "GEDI Forest Height (SVS 4950)",
    "Lightning Events Detected from the ISS 2017–2023 (SVS 5011)",
    "NASA GIBS — GHRSST MUR sea surface temperature (live frames)",
]
link_urls = [
    "https://svs.gsfc.nasa.gov/gallery/earth-information-center/",
    "https://svs.gsfc.nasa.gov/5313/",
    "https://svs.gsfc.nasa.gov/5196/",
    "https://svs.gsfc.nasa.gov/4950/",
    "https://svs.gsfc.nasa.gov/5011/",
    "https://gibs.earthdata.nasa.gov/",
]

set_text(paras[22], link_texts[0])
set_text(paras[23], link_texts[1])
set_text(paras[24], link_texts[2])
set_text(paras[25], link_texts[3])
extra_text = clone_after(paras[25], link_texts[4])
clone_after(extra_text, link_texts[5])

set_text(paras[28], link_urls[0])
set_text(paras[29], link_urls[1])
set_text(paras[30], link_urls[2])
set_text(paras[31], link_urls[3])
extra_url = clone_after(paras[31], link_urls[4])
clone_after(extra_url, link_urls[5])

# Use of AI — two honest halves
set_text(paras[36],
    "Two things, and they are different. First, the application itself contains no "
    "artificial intelligence: every measurement is arithmetic over pixels, and every "
    "sound is synthesised by code, so the translation from image to music is "
    "deterministic, reproducible and cannot hallucinate. Second, AI assisted the "
    "solo developer during the build — drafting and reviewing code, documentation and "
    "the text of this paper — and that assistance is disclosed here and in the "
    "repository. No AI output was trusted on its own: the mapping is covered by 62 "
    "automated unit checks, the page by 18 automated browser checks (accessibility "
    "tree, keyboard, export, reduced motion), and the audio was measured for "
    "loudness and clipping. All AI-assisted text was reviewed and edited by the "
    "developer, who is responsible for every claim in this document."
)

# The AI answer is a paragraph, not a list item: the template kept its one-line
# answer as a bullet, which traps a full paragraph inside a hanging indent.
paras[36].style = body_style
_ai_pPr = paras[36]._p.find(qn("w:pPr"))
if _ai_pPr is not None:
    for _num in _ai_pPr.findall(qn("w:numPr")):
        _ai_pPr.remove(_num)

# Space agency partner / other data
set_text(paras[43],
    "None. All imagery is NASA's, from the Earth Information Center content database "
    "(Scientific Visualization Studio) and NASA GIBS. No partner-agency data and no "
    "third-party datasets were used."
)

set_text(paras[47], "Not applicable — no third-party data or partner verification required.")

# the form's own field label, without the note-to-self pasted into it
set_text(paras[10], "Publicly accessible link for the application the team created.")

# --------------------------------------------------- replace the draft tail
# Everything from the marker onward is the old draft; remove it by element so no
# front-matter section can be caught by a stale index.
el = marker_el.getnext()
while el is not None:
    nxt = el.getnext()
    if el.tag.endswith("}p") or el.tag.endswith("}tbl"):
        el.getparent().remove(el)
    el = nxt
marker_el.getparent().remove(marker_el)


def add(text, style=None):
    return doc.add_paragraph(text, style=style or body_style)


def add_lead(label, text):
    p = doc.add_paragraph(style=body_style)
    r = p.add_run(label)
    r.bold = True
    p.add_run(text)
    return p


# ---------------- Detailed Project Description
add("Detailed Project Description", h1)

add("High-level summary", h2)
add(
    "NASA's Earth Information Center produces the most legible pictures we have of a "
    "changing planet, and almost all of that information is delivered through sight. "
    "Five Sides treats each visualization as a record: it cuts eighteen scenes from "
    "the published animation, measures them pixel by pixel, and plays one bar of music "
    "per scene. The result is not a soundtrack laid over a video — the sound is a "
    "reading of the image, and the image is on screen and in motion while it plays. "
    "Each bar plays its own scene, slowed to the length of the bar, so the maps drift "
    "rather than jump."
)

add("Background", h2)
add(
    "The Earth Information Center tracks how the planet is changing: eleven years of "
    "city lights, the movement of carbon dioxide through a model atmosphere, the height "
    "of forests measured by a laser in orbit, lightning recorded from the International "
    "Space Station, the heat stored in the surface of the ocean. Each of these is a "
    "visual argument, and each one is invisible to a blind or low-vision reader. That is "
    "the gap the challenge names, and it is larger than alt text: a static description "
    "of a frame cannot convey that the map is getting brighter year on year, or that the "
    "storms are moving."
)
add(
    "Sonification offers a way through. Sound carries change over time better than a "
    "still image does, and it carries it to people who cannot see at all. The design "
    "constraint that follows is the interesting one: the music cannot be decorative. If "
    "a listener hears an eleven-note phrase, the frame must actually contain eleven "
    "places worth hearing."
)

add("Method", h2)
add(
    "Five Sides is built as a fixed pipeline with a deliberate seam between measurement "
    "and music, so the mapping can be inspected and tested without listening to it."
)
add_lead("1. Fetch. ",
    "Eighteen scenes are cut from each published animation, evenly spaced, skipping the "
    "first and last six percent so title cards and fades never become music. Each scene "
    "is measured as a still and also encoded into one small clip per record, so the bar "
    "you hear plays the scene it was measured from, moving, at roughly half speed. The "
    "GIBS record has no published movie, so its scenes are dissolved from its own daily "
    "renders. The live tuner instead requests one WMS render per date from NASA GIBS, "
    "which a browser can call directly because it sends an open CORS header.")
add_lead("2. Measure. ",
    "Every second pixel is read out of a canvas: luminance, saturation, a circular-mean "
    "hue, Hasler–Süsstrunk colourfulness, position along the record's own published "
    "colour bar, a Sobel gradient field for texture, and two activity grids — sixteen "
    "vertical columns and six horizontal bands. Roughly 230,000 samples per frame, in "
    "about eight milliseconds.")
add_lead("3. Calibrate. ",
    "Space is black. Night lights and aerosol fields both average under ten percent "
    "luminance, so absolute readings would trap every record in the bottom octave and "
    "describe every frame as dark. Each feature is therefore stretched between its own "
    "10th and 90th percentile within the side, with the raw value kept for display and "
    "export; a side with no genuine variation falls back to a neutral centre instead of "
    "amplifying sensor noise.")
add_lead("4. Compose. ",
    "Measurements become one bar: a drone, a chord, a bass line, sixteen melodic steps "
    "and percussion. The record's own colour bar becomes the pitch axis — the legend the "
    "scientists drew is the thing you hear — and the sixteen columns of the map become "
    "sixteen melodic steps read left to right, so the melody crosses the stereo field as "
    "it crosses the map.")
add(
    "Three constraints keep eighteen bars of satellite data listenable as music. Every "
    "pitch is drawn from a fixed mode, so no measurement can produce a wrong note; "
    "extremes change register, density and timbre instead of key. Tempo moves at most "
    "seven BPM per bar. And the chord walks toward the degree the colour bar asks for, "
    "one scale step per bar, so harmony is a progression rather than a series of jumps. "
    "Two rows of the published mapping table are marked as artistic rather than "
    "measured, so the line between the two stays visible."
)
add_lead("5. Play. ",
    "A Web Audio lookahead scheduler places events about 120 ms ahead of the clock, so "
    "the pulse stays steady while the page animates. Export renders the identical audio "
    "graph through an OfflineAudioContext, which means the WAV a judge downloads is the "
    "performance rather than an approximation of it.")

add("Results and Discussion", h2)
add(
    "Each side is also checked for motion: the clip for every record loads at 960 px "
    "wide, the stage canvas is confirmed to change between frames while a side plays, "
    "and the scene counter follows the audio rather than the wall clock. The spectrum "
    "under the stage is an analyser on the master bus, so what it shows is the audio "
    "graph and cannot disagree with what is heard; its axis covers the band this music "
    "actually occupies, because the mix is deliberately warm and drawing to Nyquist "
    "would leave most of the strip empty."
)
add(
    "The instrument works as intended on all five records, and the numbers are the "
    "evidence. Sixty-two automated unit checks cover the analysis and composition "
    "layers, including a walk over every note of every side asserting that its interval "
    "belongs to the record's mode. Eighteen automated browser checks cover the "
    "accessibility tree (49 of 49 interactive elements carry an accessible name, one h1, "
    "two live regions, aria-current on the playing bar), keyboard operation (46 tab "
    "stops), the real Export button (a valid 52.7-second stereo WAV), reduced-motion "
    "behaviour, and load timing. A side becomes playable 0.9–1.4 seconds after "
    "navigation. The five rendered sides measure between −16.3 and −18.8 LUFS with peaks "
    "below 0.97, so nothing clips and the album sits at a consistent listening level."
)
add(
    "Three problems surfaced during the build that are worth recording, because each was "
    "a musical or interpretive error rather than a bug that a test would have caught. A "
    "nearly black frame was described as containing sixteen melodic notes, because "
    "per-frame normalisation erased the difference between faint texture and none; notes "
    "are now gated on absolute energy, and a black frame writes no notes. The harmony "
    "originally followed the colour bar directly and leapt up to six scale steps between "
    "bars, which is legal in the mode and incoherent as music; it now walks one step at "
    "a time. And the chord 'inversion' rotated the note array, which changed only the "
    "panning — it is now a real inversion, with a test that fails if the pitches match."
)
add(
    "What has not been verified is stated plainly in the repository: no screen-reader "
    "user has tested the instrument yet, and no blind or low-vision participant has "
    "listened to it. The accessibility tree is machine-checked, which proves names and "
    "roles exist and are wired, not that the experience is good. That is the next piece "
    "of work, and it is named as such rather than implied away."
)

add("Impact and Benefits", h2)
add(
    "The direct beneficiary is a reader who cannot see the visualization. Five Sides "
    "gives them the measurements in a modality that carries them better: every bar can "
    "describe itself in words, generated from the same numbers that produced the sound, "
    "and can be spoken aloud on demand or automatically as the side plays. The picture "
    "is optional; the description never is."
)
add(
    "The secondary beneficiaries are the people who can see and still cannot read a "
    "satellite product: a classroom meeting sea surface temperature for the first time, "
    "a museum floor where nobody will read a wall panel, a journalist who needs to hear "
    "the shape of a dataset before writing about it. The instrument turns a legend into "
    "an intuition — warm water is high in the scale, so the tropics sing and the poles "
    "answer low."
)
add(
    "Two design decisions carry most of the trust. The page has a 'Show NASA frame' "
    "switch that removes every overlay, leaving the unmodified source pixels: the "
    "drawing on top of the data is an interpretation, and it can be turned off in one "
    "click. And where a sensor saw nothing, the piece is silent — coverage gates the "
    "bar, so an empty swath is heard as a rest rather than disguised as sound."
)

add("Tools and Technology", h2)
add(
    "The application is deliberately dependency-free: HTML, CSS and plain JavaScript, "
    "with no framework, no bundler and no build step — a folder of plain files that any "
    "host can serve. Nothing about playback is pre-computed: the scene clips are decoded "
    "by the browser's own video pipeline and drawn into a canvas, and every note is "
    "synthesised at play time through the Web Audio API, with OfflineAudioContext for "
    "export. The pre-rendered MP3s that ship beside the page are a convenience for "
    "readers who cannot run JavaScript; the instrument itself does not play them. "
    "Python handles the one offline task, cutting scenes from the published NASA "
    "renditions with FFmpeg and writing the catalogue. Verification runs on Node: unit "
    "checks for the mapping, and a headless Chromium driven over the DevTools Protocol "
    "for the browser checks, with no test framework and no Playwright. Delivery is "
    "static hosting on Vercel — static describes where the files live, not what the "
    "page does — behind a content security policy that allows exactly the app's own "
    "files and NASA GIBS."
)

add("Considerations", h2)
add_lead("Data fidelity. ",
    "The piece is an interpretation of an eighteen-scene sample of a 39-to-217-second "
    "sequence, not a transcript of the data. That is documented in the app, the README "
    "and the exported score, and the score JSON carries every raw measurement so a "
    "researcher can check any note against any frame.")
add_lead("Calibration is relative. ",
    "A bar tells you where a scene sits within its own side. It is deliberately not a "
    "claim that one visualization is brighter than another, and the interface says so "
    "next to the meters.")
add_lead("Musical judgement is a human judgement. ",
    "The mix was measured for loudness, peaks, spectral balance and dynamic arc, but "
    "whether it sounds good is a matter of taste; the record-level settings are one "
    "short file, so a musician can retune a side without touching the engine.")
add_lead("Accessibility is machine-checked, not user-tested. ",
    "The automated accessibility tree checks prove the structure; they do not prove the "
    "listening experience for a blind user. Recruiting one tester is the highest-value "
    "next step.")
add_lead("Licensing and credit. ",
    "The imagery is NASA's and is credited per record inside the app, with the "
    "visualizers and datasets named from each published page. No NASA logo or insignia "
    "is used, and the page states that NASA does not endorse the project.")
add_lead("Longevity. ",
    "The five records are fixed scenes — the clips ship with the page — so the album "
    "will keep playing exactly as it does today. The live tuner is the part with an "
    "expiry date: it depends on GIBS staying open and CORS-enabled, and the page "
    "degrades to the local records if it cannot reach them.")

# ---------------- Demo script, in the template's five-beat shape
add("Demo script:", h1)
add("The demonstration is a thirty-second video and a six-slide deck: the video "
    "carries the sound, the deck carries the argument. The deck runs title, the "
    "problem, the mapping, how it works, the motion layer, and who it is for; this "
    "is the talk track for both, one line per beat.")

add("Introduce yourself", h2)
add("Hello — I'm the one in One Man vs All, and this is Five Sides.")

add("Lead us in", h2)
add(
    "NASA's Earth Information Center makes the most beautiful pictures we have of our "
    "changing planet. Almost nobody can hear them."
)

add("Name your project", h2)
add("…so I built Five Sides: five NASA records, played pixel by pixel.")

add("Describe your idea", h2)
add(
    "Every scene is measured — brightness, colour, texture — and those numbers become "
    "one bar of music. The colour bar in the legend becomes the pitch, so warm water "
    "sings high and cold water answers low. The strip under the map is the sound "
    "itself, tapped off the audio bus, and the numbers beside it come from the frame "
    "you are watching. Where the satellite saw nothing, it stays silent."
)

add("Look into the future", h2)
add(
    "Five records and a live frequency you can point at today's planet. You can look at "
    "the Earth, or you can listen to it."
)

# Collapse runs of blank paragraphs to one: the form's spacing survives, the
# five-empty-line gaps left in the template do not.
previous_blank = False
for p in list(doc.paragraphs):
    is_blank = not p.text.strip()
    if is_blank and previous_blank:
        p._element.getparent().remove(p._element)
        continue
    previous_blank = is_blank

doc.save(OUT)
print("written", OUT)
