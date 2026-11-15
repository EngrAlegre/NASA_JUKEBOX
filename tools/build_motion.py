#!/usr/bin/env python3
"""Build the motion layer: one short clip per record, cut to the side's bars.

The measured frames in data/records.json each carry a source timestamp `t`. This
cuts a slice of real footage around every timestamp, encodes the slices to a
single web-sized clip, and records where each scene starts. The player maps bar i
to scene i, so the animation moves inside the bar whose music it produced — the
picture and the sound stay tied to the same instant of the same NASA animation.

    python tools/build_motion.py            # all records
    python tools/build_motion.py --only co2

Outputs data/motion/<id>.mp4 and data/motion.json.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
DATA = os.path.join(ROOT, "data")
OUT_DIR = os.path.join(DATA, "motion")

WIDTH = 960          # enough for a projector at 1x, ~1.4 MB per record
FPS = 24
CRF = 28

SOURCES = {
    "nightlights": "nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4",
    "co2": "dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_1080p30_h265.mp4",
    "canopy": "GEDI_global_w_colorbar_1080p60.mp4",
    "lightning": "iss_lightning_sphere_07312023.mp4",
    "ocean": "perpetual_ocean2_CLOSE_097_SEA_ICE_ONLY_1080p30.mp4",
}


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)



def build_from_stills(rec: dict, tmp: str) -> dict | None:
    """Motion for a record whose frames are a date series (the GIBS record).

    There is no movie to cut: the animation IS the sequence of daily renders. So
    the clip is built by dissolving one measured still into the next, at the same
    scene length as the others, which keeps scene i == still i exactly.
    """
    from PIL import Image
    import numpy as np

    rid = rec["id"]
    frames = rec.get("frames") or []
    if len(frames) < 2:
        return None

    per_scene = 36          # 1.5 s at 24 fps
    dissolve = 12           # frames of cross-dissolve at the head of each scene

    imgs = []
    for f in frames:
        path = os.path.join(DATA, "records", rid, f["src"].rsplit("/", 1)[-1])
        if not os.path.exists(path):
            print(f"  ! missing still {path}")
            return None
        im = Image.open(path).convert("RGB")
        w, h = im.size
        nh = round(h * WIDTH / w / 2) * 2
        imgs.append((np.asarray(im.resize((WIDTH, nh), Image.LANCZOS), dtype=np.float32), nh))

    h = imgs[0][1]
    seq = 0
    prev = imgs[0][0]
    for i, (cur, _) in enumerate(imgs):
        base = prev if i > 0 else imgs[1][0] if len(imgs) > 1 else cur
        for j in range(per_scene):
            if i > 0 and j < dissolve:
                a = j / dissolve
                frame = base * (1 - a) + cur * a
            else:
                frame = cur
            out = os.path.join(tmp, f"{rid}_{seq:04d}.png")
            Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).save(out)
            seq += 1
        prev = cur

    out_mp4 = os.path.join(OUT_DIR, f"{rid}.mp4")
    r = run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
        "-i", os.path.join(tmp, f"{rid}_%04d.png"),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CRF + 2),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_mp4,
    ])
    if r.returncode != 0:
        print(f"  ! stills encode failed for {rid}: {r.stderr.strip()[:200]}")
        return None

    slice_s = round(per_scene / FPS, 3)
    total = round(len(imgs) * slice_s, 2)
    mb = os.path.getsize(out_mp4) / 1e6
    print(f"  {rid}: {len(imgs)} scenes x {slice_s}s from stills = {total:.2f}s, "
          f"{WIDTH}x{h}, {mb:.2f} MB")
    return {
        "id": rid, "file": f"data/motion/{rid}.mp4",
        "scenes": len(imgs), "slice": slice_s, "duration": total,
        "width": WIDTH, "height": h, "mb": round(mb, 2), "fps": FPS,
    }


def build(rec: dict, tmp: str) -> dict | None:
    rid = rec["id"]
    src = os.path.join(CACHE, SOURCES[rid])
    if not os.path.exists(src):
        print(f"  ! source missing for {rid}: {SOURCES[rid]}")
        return None

    frames = rec.get("frames") or []
    ts = [f.get("t") for f in frames if isinstance(f.get("t"), (int, float))]
    if len(ts) < 2:
        print(f"  ! {rid} has no frame timestamps")
        return None

    span = (ts[-1] - ts[0]) / max(1, len(ts) - 1)
    # A slice slightly shorter than the gap keeps consecutive scenes disjoint and
    # leaves room for the player to hold the last frame while a bar resolves.
    slice_s = round(min(span * 0.72, 1.6), 3)

    parts = []
    for i, t in enumerate(ts):
        start = max(0.0, t - slice_s / 2)
        part = os.path.join(tmp, f"{rid}_{i:02d}.mp4")
        r = run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-t", f"{slice_s:.3f}", "-i", src,
            "-vf", f"fps={FPS},scale={WIDTH}:-2:flags=lanczos",
            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CRF),
            "-pix_fmt", "yuv420p", part,
        ])
        if r.returncode != 0 or not os.path.exists(part):
            print(f"  ! slice {i} of {rid} failed: {r.stderr.strip()[:200]}")
            return None
        parts.append(part)

    listing = os.path.join(tmp, f"{rid}.txt")
    with open(listing, "w", encoding="utf-8") as fh:
        for p in parts:
            fh.write(f"file '{p.replace(chr(92), '/')}'\n")

    out = os.path.join(OUT_DIR, f"{rid}.mp4")
    r = run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", listing,
        "-c", "copy", "-movflags", "+faststart", out,
    ])
    if r.returncode != 0:
        print(f"  ! concat failed for {rid}: {r.stderr.strip()[:300]}")
        return None

    probe = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-show_entries",
                 "format=duration", "-of", "csv=p=0", out])
    vals = [v for v in probe.stdout.strip().replace("\r", "").split("\n") if v]
    dims = vals[0].split(",") if vals else ["0", "0"]
    total = float(vals[1]) if len(vals) > 1 else len(ts) * slice_s

    mb = os.path.getsize(out) / 1e6
    print(f"  {rid}: {len(ts)} scenes x {slice_s}s = {total:.2f}s, "
          f"{dims[0]}x{dims[1]}, {mb:.2f} MB")

    return {
        "id": rid, "file": f"data/motion/{rid}.mp4",
        "scenes": len(ts), "slice": slice_s, "duration": round(total, 2),
        "width": int(dims[0] or 0), "height": int(dims[1] or 0),
        "mb": round(mb, 2), "fps": FPS,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="record ids")
    ap.add_argument("--catalog-only", action="store_true",
                    help="do not rebuild clips; just register existing ones")
    args = ap.parse_args()

    records = json.load(open(os.path.join(DATA, "records.json"), encoding="utf-8"))["records"]
    wanted = [r for r in records if not args.only or r["id"] in args.only]
    os.makedirs(OUT_DIR, exist_ok=True)

    manifest_path = os.path.join(DATA, "motion.json")
    manifest = {}
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path, encoding="utf-8")).get("motion", {})
    else:
        manifest = {}

    tmp = tempfile.mkdtemp(prefix="motion-")
    try:
        for rec in wanted:
            print(f"=== {rec['id']}")
            if args.catalog_only:
                # keep whatever the manifest already says about this record
                continue
            has_movie = bool((rec.get("source") or {}).get("video"))
            entry = build(rec, tmp) if has_movie else build_from_stills(rec, tmp)
            if entry:
                manifest[rec["id"]] = entry
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    order = [r["id"] for r in records if r["id"] in manifest]
    payload = {"motion": {k: manifest[k] for k in order}}
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)

    # The page reads the catalogue, not a second file: motion is part of a record,
    # so it travels with it into records.json and the plain-script mirror.
    catalog_path = os.path.join(DATA, "records.json")
    catalog = json.load(open(catalog_path, encoding="utf-8"))
    for rec in catalog["records"]:
        m = payload["motion"].get(rec["id"])
        if m:
            rec["motion"] = {
                "file": m["file"], "scenes": m["scenes"],
                "slice": m["slice"], "duration": m["duration"],
            }
        else:
            rec.pop("motion", None)
    with open(catalog_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=2)
    with open(os.path.join(DATA, "records.js"), "w", encoding="utf-8") as fh:
        fh.write("/* generated by tools/build_library.py — do not edit */\nwindow.JUKEBOX_DATA = ")
        json.dump(catalog, fh, indent=2)
        fh.write(";\n")
    print("catalogue updated with motion")

    total = sum(m["mb"] for m in payload["motion"].values())
    print(f"\n{len(payload['motion'])} clips, {total:.1f} MB total -> data/motion.json")
    for m in payload["motion"].values():
        print(f"  {m['id']:12} {m['file']:26} {m['scenes']:>2} scenes  "
              f"{m['slice']}s  {m['duration']}s")


if __name__ == "__main__":
    sys.exit(main())
