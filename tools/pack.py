#!/usr/bin/env python3
"""
Assemble exactly what a host needs.

    python tools/pack.py            # -> dist/  (+ dist.zip)
    python tools/pack.py --no-zip

The repository contains things a server should never see: `.cache/` (hundreds of
megabytes of downloaded NASA video), `tools/`, `tests/`, source WAVs, git
history. This copies only the runtime files, so a drag-and-drop deploy uploads
~16 MB instead of ~400 MB, and the folder can be handed to anyone.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

FILES = [
    "index.html",
    "styles.css",
    "404.html",
    "manifest.webmanifest",
    "og.png",
    "_headers",
    "README.md",
    "LICENSE",
]

DIRS = ["src", "docs", "data"]

# Audio ships as MP3 only; the WAVs are build artefacts.
AUDIO_EXT = {".mp3"}


def copy_tree(src: str, dst: str, exts: set[str] | None = None) -> int:
    count = 0
    for base, _dirs, files in os.walk(src):
        rel = os.path.relpath(base, ROOT)
        target = os.path.join(DIST, rel)
        os.makedirs(target, exist_ok=True)
        for f in files:
            if exts and os.path.splitext(f)[1].lower() not in exts:
                continue
            if f.startswith(".") or f.endswith(".wav"):
                continue
            shutil.copy2(os.path.join(base, f), os.path.join(target, f))
            count += 1
    return count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-zip", action="store_true")
    ap.add_argument("--keep", action="store_true", help="do not clear dist/ first")
    args = ap.parse_args()

    if os.path.isdir(DIST) and not args.keep:
        shutil.rmtree(DIST)
    os.makedirs(DIST, exist_ok=True)

    missing = []
    for f in FILES:
        src = os.path.join(ROOT, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(DIST, f))
        else:
            missing.append(f)

    for d in DIRS:
        src = os.path.join(ROOT, d)
        if os.path.isdir(src):
            copy_tree(src, os.path.join(DIST, d))

    audio_src = os.path.join(ROOT, "audio")
    if os.path.isdir(audio_src):
        os.makedirs(os.path.join(DIST, "audio"), exist_ok=True)
        for f in sorted(os.listdir(audio_src)):
            if os.path.splitext(f)[1].lower() in AUDIO_EXT:
                shutil.copy2(os.path.join(audio_src, f), os.path.join(DIST, "audio", f))

    # Sanity: the app cannot run without these.
    required = ["index.html", "src/app.js", "src/motion.js", "data/records.js",
                "data/records/ocean/cover.png", "data/motion/nightlights.mp4"]
    for rel in required:
        if not os.path.exists(os.path.join(DIST, rel)):
            missing.append(rel)

    files = sum(len(fs) for _, _, fs in os.walk(DIST))
    size = sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(DIST) for f in fs)

    print(f"dist/  {files} files, {size / 1e6:.1f} MB")
    if missing:
        print("MISSING:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)

    if not args.no_zip:
        zip_path = DIST + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for base, _dirs, fs in os.walk(DIST):
                for f in fs:
                    full = os.path.join(base, f)
                    z.write(full, os.path.relpath(full, DIST))
        print(f"dist.zip  {os.path.getsize(zip_path) / 1e6:.1f} MB")

    print("\nnext:")
    print("  netlify drop : drag dist/ onto https://app.netlify.com/drop")
    print("  vercel       : npx vercel --prod dist")
    print("  github pages : git push, then Settings -> Pages -> GitHub Actions")
    print("  docker       : docker build -t earth-jukebox . && docker run -p 8080:80 earth-jukebox")
    print("\nafter it is live:  node tools/set-url.js https://your-url/")
    print("then verify:       node tools/qa.js https://your-url/")


if __name__ == "__main__":
    main()
