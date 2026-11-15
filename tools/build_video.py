#!/usr/bin/env python3
"""Cut the demo video from a screen capture of the instrument.

  1. tools/record.js captures the app playing, with wall-clock timings.
  2. Frames are resampled onto a 30 fps timeline so the picture runs at true
     speed even though capture stuttered.
  3. Captions are composited in PIL as a lower third — a band, not loose text,
     because loose text landed on top of the interface's own labels.
  4. The soundtrack is each side's own rendered audio, entered at the playback
     position the capture started from, so picture and sound agree.
  5. Title and end cards are generated, then everything is concatenated.

    python tools/build_video.py
    -> Five-Sides-demo.mp4 (28.7 s, 1920x1080, H.264 + AAC)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VID = os.path.join(ROOT, ".cache", "vid")
OUT = os.path.join(ROOT, "Five-Sides-demo.mp4")

W, H = 1600, 900
FPS = 30

INK = (7, 8, 11)
PAPER = (242, 245, 248)
MUTED = (155, 163, 175)
CYAN = (99, 219, 228)
AMBER = (255, 182, 72)

FONT_DIR = "C:/Windows/Fonts"
SANS = os.path.join(FONT_DIR, "segoeui.ttf")
SANS_BOLD = os.path.join(FONT_DIR, "segoeuib.ttf")
SANS_SEMI = os.path.join(FONT_DIR, "seguisb.ttf")
MONO = os.path.join(FONT_DIR, "consola.ttf")

TITLE_S, END_S = 2.2, 3.0
DUR_A, DUR_B = 14.0, 9.5


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(SANS, size)


def tracked(draw, xy, text, fnt, fill, tracking=0.0, shadow=True):
    x, y = xy
    for ch in text:
        if shadow:
            draw.text((x + 1.5, y + 1.5), ch, font=fnt, fill=(0, 0, 0, 170))
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def parse_clock(text):
    """'0:16 / 0:54' -> 16.0 — where in the side the capture began."""
    m = re.match(r"\s*(\d+):(\d+)", text or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def caption_layer(text):
    """A lower third: a band with a cyan hairline, not text floating on the UI."""
    BH = 104
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    band_top = H - BH
    d.rectangle([0, band_top, W, H], fill=(4, 5, 8, 214))
    d.rectangle([0, band_top, W, band_top + 3], fill=CYAN + (235,))

    fnt = font(SANS_SEMI, 39)
    bbox = d.textbbox((0, 0), text, font=fnt)
    text_h = bbox[3] - bbox[1]
    tracked(d, (86, band_top + (BH - text_h) / 2 - 6), text, fnt, (255, 255, 255, 255),
            tracking=0.4, shadow=False)
    return layer


def title_card():
    img = Image.new("RGB", (W, H), INK)

    frame = Image.open(os.path.join(ROOT, ".cache", "deck", "title.png")).convert("RGB")
    frame = frame.resize((W, int(W * frame.height / frame.width)))
    img.paste(frame, (0, H - frame.height))
    veil = Image.new("RGBA", (W, H), (7, 8, 11, 205))
    img = Image.alpha_composite(img.convert("RGBA"), veil)

    d = ImageDraw.Draw(img)
    tracked(d, (86, 250), "NASA SPACE APPS CHALLENGE 2026", font(MONO, 15), CYAN, 3.0)
    tracked(d, (82, 292), "Five Sides", font(SANS_BOLD, 108), PAPER, 0.5)
    tracked(d, (88, 424), "NASA Earth Information Center animations,", font(SANS, 30),
            (235, 240, 246), 0.2)
    tracked(d, (88, 466), "played as music.", font(SANS, 30), (235, 240, 246), 0.2)
    d.line([(88, 536), (248, 536)], fill=AMBER, width=3)
    tracked(d, (88, 560), "One Man vs All   ·   fivesides.site", font(MONO, 17), MUTED, 1.4)
    return img.convert("RGB")


def end_card():
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    tracked(d, (86, 330), "fivesides.site", font(SANS_BOLD, 74), PAPER, 0.4)
    tracked(d, (88, 440), "Look at the Earth — or listen to it.", font(SANS, 30),
            (235, 240, 246), 0.2)
    d.line([(88, 520), (248, 520)], fill=AMBER, width=3)
    tracked(d, (88, 544), "NASA does not endorse this project · no NASA insignia used",
            font(MONO, 15), MUTED, 1.2)
    return img


def resample(frames, ms_per_out, count):
    out, j = [], 0
    for k in range(count):
        target = k * ms_per_out
        while j + 1 < len(frames) and frames[j + 1]["ms"] <= target:
            j += 1
        out.append(frames[j]["file"])
    return out


def build_segment(name, seconds, captions, out_dir):
    d = os.path.join(VID, name)
    timing = json.load(open(os.path.join(d, "timing.json"), encoding="utf-8"))
    frames = [f for f in timing["frameList"] if f["ms"] <= seconds * 1000]
    if not frames:
        raise SystemExit(f"{name}: no frames")

    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(out_dir, f))

    count = int(round(seconds * FPS))
    order = resample(frames, 1000 / FPS, count)

    layers = [(at, caption_layer(text)) for at, text in captions]
    FADE, HOLD = 0.4, 4.2

    for k, fname in enumerate(order):
        t = k / FPS
        base = Image.open(os.path.join(d, fname)).convert("RGBA")
        if base.size != (W, H):
            base = base.resize((W, H))
        for at, layer in layers:
            rel = t - at
            if 0 <= rel <= HOLD:
                a = min(ease(rel / FADE), ease((HOLD - rel) / FADE))
                if a > 0:
                    l = layer.copy()
                    if a < 1:
                        l.putalpha(l.getchannel("A").point(lambda v: int(v * a)))
                    base.alpha_composite(l)
        base.convert("RGB").save(os.path.join(out_dir, f"f{k:05d}.jpg"), quality=93)
    return count, parse_clock(timing.get("clockStart"))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1200:], file=sys.stderr)
        raise SystemExit("ffmpeg failed")
    return r


def main():
    a_dir = os.path.join(VID, "cut-a")
    b_dir = os.path.join(VID, "cut-b")
    title_card().save(os.path.join(VID, "title.png"))
    end_card().save(os.path.join(VID, "end.png"))

    n_a, off_a = build_segment("a", DUR_A, [
        (2.4, "Every scene is measured."),
        (7.4, "Those numbers become the music."),
    ], a_dir)
    n_b, off_b = build_segment("b", DUR_B, [
        (1.0, "The picture moves inside the bar."),
    ], b_dir)
    print(f"A {n_a} frames from {off_a}s in the side · B {n_b} frames from {off_b}s")

    pieces = ["p-title.mp4", "p-a.mp4", "p-b.mp4", "p-end.mp4"]

    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", str(TITLE_S),
         "-i", os.path.join(VID, "title.png"), "-r", str(FPS),
         "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", os.path.join(VID, "p-title.mp4")])

    for tag, dpath in (("p-a", a_dir), ("p-b", b_dir)):
        run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
             "-i", os.path.join(dpath, "f%05d.jpg"), "-r", str(FPS),
             "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", os.path.join(VID, f"{tag}.mp4")])

    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", str(END_S),
         "-i", os.path.join(VID, "end.png"), "-r", str(FPS),
         "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", os.path.join(VID, "p-end.mp4")])

    with open(os.path.join(VID, "concat.txt"), "w", encoding="utf-8") as fh:
        for name in pieces:
            fh.write(f"file '{os.path.join(VID, name).replace(chr(92), '/')}'\n")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", os.path.join(VID, "concat.txt"), "-c", "copy", os.path.join(VID, "picture.mp4")])

    # soundtrack: each side's own render, entered at the capture's position
    co2 = os.path.join(ROOT, "audio", "co2.mp3")
    lg = os.path.join(ROOT, "audio", "lightning.mp3")
    afilter = (
        f"anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:{TITLE_S}[s0];"
        f"[1:a]atrim={off_a}:{off_a + DUR_A},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,"
        f"afade=t=out:st={DUR_A - 0.45:.2f}:d=0.45[a1];"
        f"[2:a]atrim={off_b}:{off_b + DUR_B},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.35,"
        f"afade=t=out:st={DUR_B - 1.2:.2f}:d=1.2[a2];"
        f"anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:{END_S}[s3];"
        f"[s0][a1][a2][s3]concat=n=4:v=0:a=1[out]"
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-i", co2, "-i", lg,
         "-filter_complex", afilter, "-map", "[out]", "-c:a", "aac", "-b:a", "192k",
         os.path.join(VID, "sound.m4a")])

    run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(VID, "picture.mp4"),
         "-i", os.path.join(VID, "sound.m4a"), "-vf", "scale=1920:1080:flags=lanczos",
         "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT])

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-show_entries", "stream=codec_name,width,height", "-of", "default=nw=1", OUT],
        capture_output=True, text=True).stdout
    print(probe.strip())
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
