#!/usr/bin/env python3
"""Build the six-slide submission deck for Five Sides.

Design system is the app's: near-black ground, one cyan accent, one amber accent,
monospace for labels and numbers, one sans for everything else. Restraint is the
point — six slides, one idea each, no bullet walls.

    python tools/build_deck.py            # writes Five-Sides-deck.pptx
    python tools/build_deck.py --png      # also renders slides via PowerPoint

Images come from .cache/deck (frames cut from the record clips) and .cache/shots
(screenshots of the running app). Both are built artefacts; see docs/DECK.md.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "Five-Sides-deck.pptx")

# ---------------------------------------------------------------- palette
INK = RGBColor(0x07, 0x08, 0x0B)
PAPER = RGBColor(0xF2, 0xF5, 0xF8)
MUTED = RGBColor(0x8B, 0x93, 0xA3)
DIM = RGBColor(0x5B, 0x62, 0x72)
HAIR = RGBColor(0x23, 0x26, 0x2E)
CYAN = RGBColor(0x63, 0xDB, 0xE4)
AMBER = RGBColor(0xFF, 0xB6, 0x48)

SANS = "Segoe UI"
SANS_SEMI = "Segoe UI Semibold"
MONO = "Consolas"

W, H = 13.333, 7.5          # inches, 16:9
M = 0.85                     # left/right margin
TOTAL = 6


# ---------------------------------------------------------------- helpers
def txbox(slide, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    return box, tf


def para(tf, text, *, size, color, font=SANS, bold=False, space_after=0,
         line=1.0, first=False, spc=None, italic=False, caps=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = PP_ALIGN.LEFT
    if line:
        p.line_spacing = line
    p.space_after = Pt(space_after)
    run = p.add_run()
    run.text = text.upper() if caps else text
    f = run.font
    f.name = font
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    if spc is not None:
        run.font._rPr.set("spc", str(int(spc * 100)))
    return p


def kicker(slide, text, x=M, y=0.52):
    _, tf = txbox(slide, x, y, 8, 0.3)
    para(tf, text, size=9.5, color=CYAN, font=MONO, spc=2.2, first=True, caps=True)


def rule(slide, x, y, w, color=HAIR, weight=0.012):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                 Inches(w), Inches(weight))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def set_alpha(shape, pct):
    """pct = opacity 0-100 of the shape's own fill."""
    fill = shape.fill._xPr.find(qn("a:solidFill"))
    if fill is None:
        return
    alpha = etree.SubElement(fill, qn("a:alpha"))
    alpha.set("val", str(int(pct * 1000)))


def scrim(slide, x, y, w, h, stops, angle=0):
    """Gradient scrim so photographs stay photographs instead of getting a panel.

    stops: [(pos_pct, opacity_pct), ...] with #07080B as the colour.
    """
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                 Inches(w), Inches(h))
    shp.line.fill.background()
    shp.shadow.inherit = False

    spPr = shp._element.spPr
    for tag in ("a:solidFill", "a:noFill", "a:gradFill", "a:pattFill"):
        for el in spPr.findall(qn(tag)):
            spPr.remove(el)

    # CT_ShapeProperties is an ordered sequence: geometry, then fill, then line.
    # Appending the gradient after <a:ln> produces a file PowerPoint refuses to
    # open even though python-pptx writes and re-reads it happily.
    grad = etree.Element(qn("a:gradFill"))
    ln = spPr.find(qn("a:ln"))
    if ln is not None:
        ln.addprevious(grad)
    else:
        spPr.append(grad)
    grad.set("rotWithShape", "1")
    lst = etree.SubElement(grad, qn("a:gsLst"))
    for pos, op in stops:
        gs = etree.SubElement(lst, qn("a:gs"))
        gs.set("pos", str(int(pos * 1000)))
        clr = etree.SubElement(gs, qn("a:srgbClr"))
        clr.set("val", "07080B")
        a = etree.SubElement(clr, qn("a:alpha"))
        a.set("val", str(int(op * 1000)))
    lin = etree.SubElement(grad, qn("a:lin"))
    lin.set("ang", str(int(angle * 60000)))
    lin.set("scaled", "1")
    return shp


def cover(slide, path, x=0, y=0, w=W, h=H):
    """Fill a rectangle with an image, cropping the overflow — never squashing it."""
    from PIL import Image
    iw, ih = Image.open(path).size
    target = w / h
    actual = iw / ih
    pic = slide.shapes.add_picture(path, Inches(x), Inches(y), Inches(w), Inches(h))
    if actual > target:                 # image too wide: trim left/right
        trim = (1 - target / actual) / 2
        pic.crop_left = trim
        pic.crop_right = trim
    elif actual < target:               # image too tall: trim top/bottom
        trim = (1 - actual / target) / 2
        pic.crop_top = trim
        pic.crop_bottom = trim
    return pic


def picture(slide, path, x, y, w=None, h=None):
    kw = {}
    if w:
        kw["width"] = Inches(w)
    if h:
        kw["height"] = Inches(h)
    return slide.shapes.add_picture(path, Inches(x), Inches(y), **kw)


def frame(slide, x, y, w, h, fill=RGBColor(0x0D, 0x0F, 0x14)):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y),
                                 Inches(w), Inches(h))
    shp.adjustments[0] = 0.02
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = HAIR
    shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    return shp


def footer(slide, n, label="Five Sides · One Man vs All"):
    rule(slide, M, 6.86, W - 2 * M)
    _, tf = txbox(slide, M, 6.99, 8, 0.24)
    para(tf, label, size=8.5, color=DIM, font=MONO, spc=1.2, first=True, caps=True)
    _, tf2 = txbox(slide, W - M - 1.2, 6.99, 1.2, 0.24)
    p = para(tf2, f"{n:02d} / {TOTAL:02d}", size=8.5, color=DIM, font=MONO,
             spc=1.2, first=True)
    p.alignment = PP_ALIGN.RIGHT


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def blank(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = INK
    return s


# ---------------------------------------------------------------- slides
def slide_title(prs):
    s = blank(prs)
    # the lightning frame is 16:9, so it fills the slide exactly
    picture(s, os.path.join(MEDIA, "deck", "title.png"), 0, 0, w=W, h=H)
    scrim(s, 0, 0, 8.4, H, [(0, 97), (55, 92), (100, 0)], angle=0)

    kicker(s, "NASA Space Apps Challenge 2026 · The Earth Information Jukebox", y=1.15)

    _, tf = txbox(s, M, 1.62, 7.2, 1.5)
    para(tf, "Five Sides", size=66, color=PAPER, font=SANS_SEMI, line=0.95, first=True)

    _, tf = txbox(s, M, 3.0, 6.6, 1.2)
    para(tf, "NASA Earth Information Center animations,\nplayed as music.",
         size=21, color=PAPER, line=1.25, first=True)

    rule(s, M, 4.62, 2.2, color=AMBER, weight=0.02)

    _, tf = txbox(s, M, 4.9, 6.8, 1.2)
    para(tf, "Eighteen scenes of a published NASA animation. Every one measured, "
             "pixel by pixel, and played as one bar.",
         size=12.5, color=MUTED, line=1.45, first=True)

    _, tf = txbox(s, M, 6.42, 8, 0.3)
    para(tf, "fivesides.site   ·   One Man vs All   ·   Manila, Philippines",
         size=10, color=CYAN, font=MONO, spc=1.2, first=True)

    notes(s, "Five Sides. Five NASA Earth Information Center records, played as music — "
             "and a live tuner for today's planet. Solo entry for the Earth Information "
             "Jukebox challenge. Everything you are about to see is running in a browser "
             "from NASA's own imagery.")
    return s


def slide_problem(prs):
    s = blank(prs)
    # The Night Lights plate is a multi-panel series: laid across the slide it reads
    # as a tiling bug. The sea-surface map is one continuous image, so it bleeds.
    cover(s, os.path.join(MEDIA, "deck", "ocean.png"))
    scrim(s, 0, 0, W, H, [(0, 55), (100, 55)], angle=0)          # global damping
    scrim(s, 0, 0, 9.2, H, [(0, 94), (62, 82), (100, 0)], angle=0)

    kicker(s, "01 · The problem")
    _, tf = txbox(s, M, 1.06, 8.4, 1.6)
    para(tf, "Earth science arrives\nas pictures.", size=42, color=PAPER,
         font=SANS_SEMI, line=1.04, first=True)

    _, tf = txbox(s, M, 3.06, 6.9, 1.6)
    para(tf, "The Earth Information Center tracks eleven years of city lights, the height "
             "of forests, the heat in the ocean surface. All of it is delivered through "
             "sight \u2014 and a still image cannot say \u201cit is getting brighter every "
             "year.\u201d",
         size=13, color=RGBColor(0xD6, 0xDC, 0xE4), line=1.55, first=True)

    rule(s, M, 6.16, 2.2, color=AMBER, weight=0.02)
    _, tf = txbox(s, M, 6.32, 8.6, 0.5)
    para(tf, "If you cannot see it, you do not get it.", size=18, color=AMBER,
         font=SANS_SEMI, first=True)

    _, tf = txbox(s, W - 3.2, 6.95, 2.5, 0.3)
    p = para(tf, "GHRSST · NASA GIBS", size=8.5, color=RGBColor(0xC9, 0xD1, 0xDB),
             font=MONO, spc=1.0, first=True)
    p.alignment = PP_ALIGN.RIGHT

    notes(s, "Five records: City Lights, Carbon Weather, Canopy, Lightning, Ocean Heat. "
             "Each is a visual argument, and each is invisible to a blind or low-vision "
             "reader. Alt text is not enough \u2014 a static description cannot carry change "
             "over time. That gap is what this project attacks.")
    return s


def slide_idea(prs):
    s = blank(prs)
    kicker(s, "02 · The idea")

    LEFT_W = 5.45          # left column stays clear of the mapping rows
    RX = 6.45              # right column origin
    LW = 2.45              # measurement label width
    WX = RX + 2.62
    WW = W - M - WX        # "why" column runs to the right margin

    _, tf = txbox(s, M, 1.04, LEFT_W, 1.6)
    para(tf, "What if the same pixels arrived through the ears?", size=30, color=PAPER,
         font=SANS_SEMI, line=1.12, first=True)

    _, tf = txbox(s, M, 2.86, LEFT_W, 1.9)
    para(tf, "Sonification is not a soundtrack laid over a video. The image is measured, "
             "and the measurement becomes the music — so every note can be traced back to "
             "a number in a real frame.",
         size=12.5, color=MUTED, line=1.55, first=True)

    rows = [
        ("Mean luminance", "octave", "a luminous frame sings high"),
        ("Position on the colour bar", "pitch", "the legend becomes the scale"),
        ("Gradient texture", "note density", "busy maps earn sixteenths"),
        ("Change since the last scene", "tempo", "a rearranging planet moves faster"),
    ]
    y = 1.28
    rule(s, RX, y - 0.2, W - M - RX)
    for a, b, why in rows:
        _, tf = txbox(s, RX, y, LW, 0.34)
        para(tf, a, size=12.5, color=PAPER, font=SANS_SEMI, first=True)
        _, tf = txbox(s, RX, y + 0.32, LW, 0.28)
        para(tf, b.upper(), size=9, color=CYAN, font=MONO, spc=1.6, first=True)
        _, tf = txbox(s, WX, y + 0.06, WW, 0.6)
        para(tf, why, size=11.5, color=MUTED, line=1.35, first=True)
        rule(s, RX, y + 1.02, W - M - RX)
        y += 1.26

    _, tf = txbox(s, M, 6.34, 11, 0.4)
    para(tf, "Eighteen scenes per record. Eighteen bars. No note is invented.",
         size=12, color=DIM, font=MONO, spc=1.0, first=True)

    footer(s, 3)
    notes(s, "The mapping is fixed and inspectable: luminance picks register, position on "
             "the record's own published colour bar picks the scale degree, texture picks "
             "note density, frame-to-frame change picks tempo. The sixteen columns of the "
             "map become sixteen melodic steps read left to right, so the melody crosses "
             "the stereo field as it crosses the map.")
    return s


def slide_how(prs):
    s = blank(prs)
    kicker(s, "03 · How it works")

    _, tf = txbox(s, M, 1.04, 6.25, 0.7)
    para(tf, "Every note is a measurement.", size=29, color=PAPER, font=SANS_SEMI,
         line=1.1, first=True)

    steps = [
        ("01", "Fetch", "Eighteen scenes cut from the published animation, title cards skipped."),
        ("02", "Measure", "230,000 pixels sampled per frame: luminance, hue, texture, sixteen columns."),
        ("03", "Calibrate", "Stretched within each side's own 10th–90th percentile. Space is black."),
        ("04", "Compose", "One fixed mode, tempo glides of 7 BPM, harmony walks one step per bar."),
        ("05", "Play", "Web Audio lookahead. Export renders the same graph offline."),
    ]
    y = 2.28
    for num, name, what in steps:
        _, tf = txbox(s, M, y, 0.5, 0.3)
        para(tf, num, size=9.5, color=AMBER, font=MONO, first=True)
        _, tf = txbox(s, M + 0.52, y - 0.06, 1.25, 0.34)
        para(tf, name, size=13.5, color=PAPER, font=SANS_SEMI, first=True)
        _, tf = txbox(s, M + 1.85, y - 0.03, 4.1, 0.62)
        para(tf, what, size=11, color=MUTED, line=1.35, first=True)
        y += 0.86
    rule(s, M, 6.3, 6.1)

    # A screenshot of the mapping table was unreadable at slide scale, and the
    # table is already on slide 3. Numbers can be read, so they carry this side.
    RX2, RW2 = 7.05, W - M - 7.05
    stats = [
        ("230,000", "pixels measured in every frame"),
        ("8 ms", "to measure one frame, in the browser"),
        ("18 \u2192 18", "scenes to bars \u2014 deterministic, no randomness"),
        ("62", "automated checks on the composition"),
    ]
    y = 1.16
    rule(s, RX2, y - 0.14, RW2)
    for big, label in stats:
        _, tf = txbox(s, RX2, y, RW2, 0.62)
        para(tf, big, size=32, color=AMBER, font=SANS_SEMI, line=1.0, first=True)
        _, tf = txbox(s, RX2, y + 0.62, RW2, 0.4)
        para(tf, label, size=11.5, color=MUTED, line=1.25, first=True)
        rule(s, RX2, y + 1.16, RW2)
        y += 1.3

    _, tf = txbox(s, RX2, 6.36, RW2, 0.5)
    para(tf, "No machine learning anywhere in the pipeline.", size=10.5, color=CYAN,
         font=MONO, spc=0.8, first=True)

    footer(s, 4)
    notes(s, "Nothing here is a black box. The analysis is arithmetic over pixels in about "
             "eight milliseconds; the composition is a pure function from measurements to "
             "bars. Two constraints keep eighteen bars of satellite data listenable: every "
             "pitch comes from a fixed mode, so no measurement can produce a wrong note, "
             "and tempo can only move seven BPM per bar. Both are covered by 62 automated "
             "checks.")
    return s


def slide_moves(prs):
    s = blank(prs)
    kicker(s, "04 · It moves")

    _, tf = txbox(s, M, 1.02, 9.6, 0.9)
    para(tf, "The picture moves inside the music.", size=34, color=PAPER,
         font=SANS_SEMI, line=1.1, first=True)

    a = os.path.join(MEDIA, "deck", "move1.png")
    b = os.path.join(MEDIA, "deck", "move2.png")
    hh = 2.92
    ww = hh * 16 / 9
    gap = 0.3
    x0 = (W - (2 * ww + gap)) / 2
    y = 2.35
    picture(s, a, x0, y, w=ww, h=hh)
    picture(s, b, x0 + ww + gap, y, w=ww, h=hh)

    _, tf = txbox(s, x0, y + hh + 0.14, ww, 0.3)
    para(tf, "t = 5.5 s", size=9.5, color=DIM, font=MONO, first=True)
    _, tf = txbox(s, x0 + ww + gap, y + hh + 0.14, ww, 0.3)
    para(tf, "t = 9.5 s", size=9.5, color=DIM, font=MONO, first=True)

    _, tf = txbox(s, x0, 5.98, 2 * ww + gap, 0.7)
    para(tf, "Each bar plays the scene it was measured from, slowed to the length of "
             "the bar — so the maps drift instead of cutting.",
         size=13, color=PAPER, line=1.4, first=True)

    _, tf = txbox(s, x0, 6.46, 2 * ww + gap, 0.3)
    para(tf, "DYAMOND carbon dioxide · NASA Goddard · Earth Information Center",
         size=9.5, color=DIM, font=MONO, spc=1.0, first=True)

    footer(s, 5)
    notes(s, "This is the newest part of the build. Each record is cut into eighteen scenes "
             "and encoded as a clip; the stage draws the clip, so the animation runs at "
             "roughly half speed inside the bar. The GIBS record has no movie, so its "
             "scenes are dissolved from its own daily renders. Reduced motion keeps the "
             "scene and stops the drift.")
    return s


def slide_access(prs):
    s = blank(prs)
    kicker(s, "05 · Who it is for")

    _, tf = txbox(s, M, 1.02, 8.6, 1.5)
    para(tf, "The picture is optional.\nThe description never is.", size=34, color=PAPER,
         font=SANS_SEMI, line=1.12, first=True)

    items = [
        ("Spoken, not summarised", "Every bar can describe itself in words, from the same numbers that made the sound."),
        ("Keyboard first", "Play, step, switch record, read the description \u2014 no pointer needed."),
        ("Reduced motion honoured", "The scene stays; the drift stops."),
    ]
    y = 3.15
    for name, what in items:
        rule(s, M, y - 0.14, 5.9)
        _, tf = txbox(s, M, y, 5.9, 0.32)
        para(tf, name, size=12.5, color=CYAN, font=SANS_SEMI, first=True)
        _, tf = txbox(s, M, y + 0.34, 5.9, 0.6)
        para(tf, what, size=11.5, color=MUTED, line=1.4, first=True)
        y += 1.12

    IW = 5.21
    IH = IW * 849 / 1584
    frame(s, 7.15, 1.02, IW + 0.12, IH + 0.12)
    picture(s, os.path.join(MEDIA, "shots", "desc.png"), 7.21, 1.08, w=IW)
    _, tf = txbox(s, 7.15, 1.02 + IH + 0.3, IW + 0.12, 0.6)
    para(tf, "The bar\u2019s own description, generated from the numbers that made the sound.",
         size=10, color=DIM, line=1.35, first=True)

    _, tf = txbox(s, M, 6.42, 11, 0.4)
    para(tf, "fivesides.site   ·   github.com/EngrAlegre/NASA_JUKEBOX", size=10.5,
         color=CYAN, font=MONO, spc=1.2, first=True)

    footer(s, 6, label="NASA does not endorse this project · no NASA insignia used")
    notes(s, "The accessibility claim is machine-checked, not asserted: 49 of 49 interactive "
             "elements carry an accessible name, one h1, two live regions, 46 tab stops, and "
             "an exported WAV measured at 52.7 seconds. What has not been done is stated "
             "plainly in the repository: no blind participant has tested it yet. That is "
             "the next piece of work.")
    return s



def check_geometry(prs):
    """Nothing may hang off the slide or have a negative extent.

    python-pptx writes whatever it is told; PowerPoint then refuses to open the
    file with a message that names no shape. This turns that into a build error
    that says exactly which shape is wrong.
    """
    problems = []
    for i, slide in enumerate(prs.slides, 1):
        for shp in slide.shapes:
            w = shp.width or 0
            h = shp.height or 0
            if w <= 0 or h <= 0:
                problems.append(f"slide {i}: '{shp.shape_type}' has extent {w}x{h}")
            right = (shp.left or 0) + w
            bottom = (shp.top or 0) + h
            if right > Inches(W) + Emu(9000) or bottom > Inches(H) + Emu(9000):
                problems.append(
                    f"slide {i}: shape overflows slide "
                    f"({right/914400:.2f}x{bottom/914400:.2f} in)")
    if problems:
        raise SystemExit("geometry problems:\n  " + "\n  ".join(problems))
    return True


# ---------------------------------------------------------------- build
def build(path=OUT):
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    slide_title(prs)
    slide_problem(prs)
    slide_idea(prs)
    slide_how(prs)
    slide_moves(prs)
    slide_access(prs)

    check_geometry(prs)
    prs.save(path)
    print(f"wrote {path} ({os.path.getsize(path)/1e6:.2f} MB, {len(prs.slides.__iter__.__self__._sldIdLst)} slides)")
    return path


def render(path, outdir):
    """Render slides to PNG with the PowerPoint that is actually installed."""
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)
    script = f'''
$ErrorActionPreference = "Stop"
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open("{os.path.abspath(path)}", $true, $false, $false)
$i = 0
foreach ($s in $pres.Slides) {{
  $i++
  $s.Export("{outdir}\\slide$i.png", "PNG", 1600, 900)
}}
$pres.Close()
$app.Quit()
Write-Output "rendered $i slides"
'''
    r = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                       capture_output=True, text=True, timeout=300)
    print(r.stdout.strip() or r.stderr.strip()[:400])
    return r.returncode


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", action="store_true", help="render slides to PNG")
    args = ap.parse_args()

    out = build()
    if args.png:
        render(out, os.path.join(ROOT, ".cache", "deck-render"))
