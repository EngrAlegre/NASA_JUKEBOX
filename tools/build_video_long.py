#!/usr/bin/env python3
"""Cut the 60-second feature reel from captured takes.

Nine segments, each cut from a real capture of the instrument playing, each
scored with the slice of that side's own audio that corresponds to the frames on
screen. Captions are a lower third so they never fight the interface's labels.

    python tools/capture_takes.py     # six takes -> .cache/vid/l-*
    python tools/build_video_long.py  # -> Five-Sides-demo-60s.mp4

Note: the challenge accepts a 30-second video or a 7-slide deck. This longer cut
is for portfolio, social and local-event use; Five-Sides-demo.mp4 stays the
submission candidate.
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
WORK = os.path.join(VID, "long")
OUT = os.path.join(ROOT, "Five-Sides-demo-60s.mp4")

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

# name, take dir, in-point (s), duration (s), audio file, captions [(at, text)]
SEGMENTS = [
    ("co2",     "l-a", 0.6, 14.0, "co2.mp3", [
        (2.2, "Every scene is measured."),
        (7.4, "Those numbers become the music."),
        (11.4, "Carbon dioxide, played as pitch and pulse."),
    ]),
    ("canopy",  "l-b", 0.6, 6.5, "canopy.mp3", [
        (0.8, "Five records. One instrument."),
    ]),
    ("light",   "l-c", 0.6, 6.5, "lightning.mp3", [
        (0.7, "The picture moves inside the bar."),
    ]),
    ("ocean",   "l-d", 0.6, 6.5, "ocean.mp3", [
        (0.7, "The legend's colour bar is the scale."),
    ]),
    ("night",   "l-e", 0.6, 6.5, "nightlights.mp3", [
        (0.7, "Eleven years of city lights."),
    ]),
    ("keys",    "l-f", 2.6, 4.6, "co2.mp3", [
        (0.3, "Every control is on the keyboard."),
    ]),
    ("source",  "l-f", 8.2, 4.4, "co2.mp3", [
        (0.3, "Show NASA frame — every overlay off."),
    ]),
    ("export",  "l-f", 13.4, 3.2, "co2.mp3", [
        (0.2, "Export the WAV you just heard."),
    ]),
]

TITLE_S, END_S = 2.5, 2.5


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
    m = re.match(r"\s*(\d+):(\d+)", text or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def caption_layer(text):
    BH = 104
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    top = H - BH
    d.rectangle([0, top, W, H], fill=(4, 5, 8, 252))
    d.rectangle([0, top, W, top + 3], fill=CYAN + (235,))
    fnt = font(SANS_SEMI, 38)
    bbox = d.textbbox((0, 0), text, font=fnt)
    tracked(d, (86, top + (BH - (bbox[3] - bbox[1])) / 2 - 6), text, fnt,
            (255, 255, 255, 255), tracking=0.4, shadow=False)
    return layer


def title_card():
    img = Image.new("RGB", (W, H), INK)
    frame = Image.open(os.path.join(ROOT, ".cache", "deck", "title.png")).convert("RGB")
    frame = frame.resize((W, int(W * frame.height / frame.width)))
    img.paste(frame, (0, H - frame.height))
    img = Image.alpha_composite(img.convert("RGBA"), Image.new("RGBA", (W, H), (7, 8, 11, 205)))
    d = ImageDraw.Draw(img)
    tracked(d, (86, 250), "NASA SPACE APPS CHALLENGE 2026", font(MONO, 15), CYAN, 3.0)
    tracked(d, (82, 292), "Five Sides", font(SANS_BOLD, 108), PAPER, 0.5)
    tracked(d, (88, 424), "NASA Earth Information Center animations,", font(SANS, 30), (235, 240, 246), 0.2)
    tracked(d, (88, 466), "played as music.", font(SANS, 30), (235, 240, 246), 0.2)
    d.line([(88, 536), (248, 536)], fill=AMBER, width=3)
    tracked(d, (88, 560), "One Man vs All   ·   fivesides.site", font(MONO, 17), MUTED, 1.4)
    return img.convert("RGB")


def end_card():
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    tracked(d, (86, 300), "fivesides.site", font(SANS_BOLD, 78), PAPER, 0.4)
    tracked(d, (88, 412), "Five records, one live tuner, and every bar that can speak.",
            font(SANS, 27), (235, 240, 246), 0.2)
    d.line([(88, 478), (248, 478)], fill=AMBER, width=3)
    tracked(d, (88, 502), "One Man vs All · NASA does not endorse this project",
            font(MONO, 15), MUTED, 1.2)
    return img


def resample(frames, per_out, count):
    out, j = [], 0
    for k in range(count):
        target = k * per_out
        while j + 1 < len(frames) and frames[j + 1]["ms"] <= target:
            j += 1
        out.append(frames[j]["file"])
    return out


def build_segment(name, take, start, dur, captions, out_dir):
    d = os.path.join(VID, take)
    timing = json.load(open(os.path.join(d, "timing.json"), encoding="utf-8"))
    lo, hi = start * 1000, (start + dur) * 1000
    frames = [f for f in timing["frameList"] if lo <= f["ms"] <= hi]
    if len(frames) < 4:
        raise SystemExit(f"{name}: only {len(frames)} frames in window")

    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(out_dir, f))

    # rebase timings to the segment start, then resample to 30 fps
    base = frames[0]["ms"]
    for f in frames:
        f["ms"] -= base
    count = int(round(dur * FPS))
    order = resample(frames, 1000 / FPS, count)

    layers = [(at, caption_layer(text)) for at, text in captions]
    FADE, HOLD = 0.35, 3.4

    for k, fname in enumerate(order):
        t = k / FPS
        img = Image.open(os.path.join(d, fname)).convert("RGBA")
        if img.size != (W, H):
            img = img.resize((W, H))
        for at, layer in layers:
            rel = t - at
            if 0 <= rel <= HOLD:
                a = min(ease(rel / FADE), ease((HOLD - rel) / FADE))
                if a > 0:
                    l = layer.copy()
                    if a < 1:
                        l.putalpha(l.getchannel("A").point(lambda v: int(v * a)))
                    img.alpha_composite(l)
        img.convert("RGB").save(os.path.join(out_dir, f"f{k:05d}.jpg"), quality=93)

    audio_off = parse_clock(timing.get("clockStart")) + start
    return count, audio_off


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1200:], file=sys.stderr)
        raise SystemExit("ffmpeg failed")
    return r


def main():
    os.makedirs(WORK, exist_ok=True)
    title_card().save(os.path.join(WORK, "title.png"))
    end_card().save(os.path.join(WORK, "end.png"))

    video_parts, audio_parts = [], []
    total = 0.0

    def encode_still(png, seconds, out):
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", f"{seconds}",
             "-i", png, "-r", str(FPS), "-c:v", "libx264", "-crf", "18",
             "-pix_fmt", "yuv420p", out])

    def silence(seconds, out):
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
             "-t", f"{seconds}", "-c:a", "pcm_s16le", out])

    encode_still(os.path.join(WORK, "title.png"), TITLE_S, os.path.join(WORK, "v-title.mp4"))
    silence(TITLE_S, os.path.join(WORK, "a-title.wav"))
    video_parts.append("v-title.mp4")
    audio_parts.append("a-title.wav")
    total += TITLE_S

    for name, take, start, dur, audio, caps in SEGMENTS:
        seg_dir = os.path.join(WORK, name)
        n, off = build_segment(name, take, start, dur, caps, seg_dir)
        v = f"v-{name}.mp4"
        run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
             "-i", os.path.join(seg_dir, "f%05d.jpg"), "-r", str(FPS),
             "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
             os.path.join(WORK, v)])
        video_parts.append(v)

        a = f"a-{name}.wav"
        src = os.path.join(ROOT, "audio", audio)
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{off:.2f}", "-t", f"{dur:.2f}",
             "-i", src, "-af",
             f"afade=t=in:st=0:d=0.18,afade=t=out:st={max(0, dur - 0.22):.2f}:d=0.22",
             "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", os.path.join(WORK, a)])
        audio_parts.append(a)
        print(f"  {name:9} {dur:>5.1f}s  {n:3} frames  audio {audio} @ {off:.1f}s")
        total += dur

    encode_still(os.path.join(WORK, "end.png"), END_S, os.path.join(WORK, "v-end.mp4"))
    silence(END_S, os.path.join(WORK, "a-end.wav"))
    video_parts.append("v-end.mp4")
    audio_parts.append("a-end.wav")
    total += END_S

    print(f"timeline {total:.2f} s")

    for kind, parts, name in (("v", video_parts, "picture.mp4"), ("a", audio_parts, "sound.wav")):
        lst = os.path.join(WORK, f"{kind}-list.txt")
        with open(lst, "w", encoding="utf-8") as fh:
            for p in parts:
                fh.write(f"file '{os.path.join(WORK, p).replace(chr(92), '/')}'\n")
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
             "-c", "copy" if kind == "v" else "pcm_s16le", os.path.join(WORK, name)])

    run(["ffmpeg", "-y", "-loglevel", "error",
         "-i", os.path.join(WORK, "picture.mp4"), "-i", os.path.join(WORK, "sound.wav"),
         "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-crf", "20",
         "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", "-shortest", OUT])

    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-show_entries", "stream=codec_name,width,height",
                            "-of", "default=nw=1", OUT], capture_output=True, text=True).stdout
    print(probe.strip())
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
