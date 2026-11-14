#!/usr/bin/env python3
"""
Build the jukebox library from NASA's Earth Information Center content.

The challenge points at the EIC Content Database (the Scientific Visualization
Studio gallery used by the EIC dashboards). This script turns six of those
published visualizations into local frame sequences the browser can read without
a network, and writes a catalog with the real credits, dataset names and source
links so the app can print proper liner notes.

Usage
-----
    python tools/build_library.py                # build everything missing
    python tools/build_library.py --only co2     # one record
    python tools/build_library.py --frames 16     # frames per record

Downloads are cached in .cache/ (gitignored) and re-used on later runs, so a
rebuild after editing the catalog spec costs no bandwidth.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
DATA = os.path.join(ROOT, "data")
SVS = "https://svs.gsfc.nasa.gov"

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

UA = {"User-Agent": "Mozilla/5.0 (compatible; EarthJukebox/1.0; +spaceappschallenge)"}

# --------------------------------------------------------------------------
# The album. Six records, one per sphere of the Earth system, all drawn from
# the EIC Content Database. `file` is the published rendition we sample; the
# smallest usable one keeps the repository honest about size.
# --------------------------------------------------------------------------
RECORDS = [
    {
        "id": "nightlights",
        "svs": 5313,
        "file": "nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4",
        "title": "City Lights",
        "side": "Human Footprint",
        "year": "2012—2023",
        "blurb": "Eleven years of electric light, compressed into one side. Where we build, the map learns to sing.",
        "instrument": "glass bells, sub bass, brushed hats",
    },
    {
        "id": "co2",
        "svs": 5196,
        "file": "dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_1080p30_h265.mp4",
        "title": "Carbon Weather",
        "side": "Atmosphere",
        "year": "DYAMOND model · simulated January 2020",
        "blurb": "A model atmosphere breathing carbon dioxide. The point cloud thickens and the chord darkens with it.",
        "instrument": "reed organ, low strings, tape hiss",
    },
    {
        "id": "canopy",
        "svs": 4950,
        "file": "GEDI_global_w_colorbar_1080p60.mp4",
        "title": "Canopy",
        "side": "Biosphere",
        "year": "GEDI, 2019—2021",
        "blurb": "Forest height from a laser in orbit. Tall canopy rings out as bright, wide-open harmony.",
        "instrument": "marimba, airy pad, soft mallets",
    },
    {
        "id": "lightning",
        "svs": 5011,
        "file": "iss_lightning_sphere_07312023.mp4",
        "title": "Lightning",
        "side": "Weather",
        "year": "ISS, 2017—2023",
        "blurb": "Six years of flashes seen from the space station. Every strike is a transient, so the piece is percussion first.",
        "instrument": "kick, snaps, metallic noise, stabs",
    },
]

# --------------------------------------------------------------------------
# Live-data records. Same engine, but the frames are WMS renders pulled from
# NASA GIBS, so the "side" is whatever the last few weeks of the planet did.
# GIBS sends `Access-Control-Allow-Origin: *`, which is what lets the page read
# these pixels without a proxy.
# --------------------------------------------------------------------------
GIBS_RECORDS = [
    {
        "id": "ocean",
        "gibs": "GHRSST_L4_MUR_Sea_Surface_Temperature",
        "title": "Ocean Heat",
        "side": "Ocean",
        "year": "daily · last 18 days",
        "blurb": "Eighteen mornings of sea surface temperature. Cold water answers low, warm water climbs the scale.",
        "instrument": "bowed bass, water-drop plucks, soft pulse",
        "step": 1,
    },
]

GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"


def gibs_url(layer: str, day: str, w: int, h: int) -> str:
    from urllib.parse import urlencode

    q = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1",
        "LAYERS": layer, "STYLES": "", "FORMAT": "image/png",
        "TRANSPARENT": "TRUE", "SRS": "EPSG:4326",
        # WMS 1.1.1 + EPSG:4326 takes BBOX as minx,miny,maxx,maxy = lon,lat,lon,lat.
        "BBOX": "-180,-90,180,90", "WIDTH": str(w), "HEIGHT": str(h), "TIME": day,
    }
    return f"{GIBS_WMS}?{urlencode(q)}"


def build_gibs(rec: dict, count: int, width: int) -> dict:
    """Render N daily GIBS frames, ending a few days behind today."""
    import datetime

    rid = rec["id"]
    h = int(round(width / 2))
    out_dir = os.path.join(DATA, "records", rid)
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".png") or f.endswith(".jpg"):
            os.remove(os.path.join(out_dir, f))

    end = datetime.date.today() - datetime.timedelta(days=4)
    dates = [end - datetime.timedelta(days=rec.get("step", 1) * (count - 1 - i)) for i in range(count)]

    frames = []
    for i, d in enumerate(dates):
        day = d.isoformat()
        dest = os.path.join(out_dir, f"f{i + 1:03d}.png")
        try:
            fetch(gibs_url(rec["gibs"], day, width, h), dest, timeout=120)
        except Exception as e:
            print(f"  {day}: {e}")
            continue
        frames.append({"file": os.path.basename(dest), "t": i, "date": day})
    print(f"  {len(frames)} frames from GIBS ({dates[0]} .. {dates[-1]})")

    # cover: the middle frame, flattened onto the same near-black the page uses
    mid = os.path.join(out_dir, frames[len(frames) // 2]["file"])
    cover = os.path.join(out_dir, "cover.png")
    flat = Image.new("RGB", (width // 2, h // 2), (7, 8, 12))
    im = Image.open(mid).convert("RGBA").resize((width // 2, h // 2))
    flat.paste(im, (0, 0), im)
    flat.save(cover, quality=88)

    return {
        "id": rid,
        "title": rec["title"],
        "side": rec["side"],
        "year": rec["year"],
        "blurb": rec["blurb"],
        "instrument": rec["instrument"],
        "source": {
            "title": f"{rec['gibs']} (NASA GIBS)",
            "agency": "NASA Global Imagery Browse Services (GIBS)",
            "url": "https://gibs.earthdata.nasa.gov/",
            "credit": "NASA EOSDIS GIBS · GHRSST MUR sea surface temperature",
            "roles": [],
            "datasets": [rec["gibs"]],
            "video": None,
            "live": True,
            "built": datetime.date.today().isoformat(),
        },
        "cover": f"records/{rid}/cover.png",
        "frames": [
            {"src": f"records/{rid}/{f['file']}", "t": f["t"], "n": i + 1, "label": f["date"]}
            for i, f in enumerate(frames)
        ],
    }


# ------------------------------ helpers -----------------------------------

def fetch(url: str, dest: str | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as r:
        data = r.read()
    if dest:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
    return data


def run(cmd: list[str]) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:3])}... failed:\n{p.stderr[-2000:]}")
    return p.stdout


def strip_tags(s: str) -> str:
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


ROLE_LABELS = [
    "Visualizer", "Scientists", "Producer", "Technical support",
    "Writer", "Data provider", "Designer", "Animator", "Web developer",
]


def parse_credits(page: str) -> dict:
    """Pull the real credit block off an SVS item page."""
    out: dict = {"credit": "NASA's Scientific Visualization Studio", "roles": [], "datasets": [], "shortUrl": ""}

    m = re.search(r"Please give credit for this item to:\s*(?:<[^>]+>\s*)*([^<]{3,160})", page)
    if m:
        out["credit"] = html.unescape(m.group(1)).strip()

    # Roles appear as a label followed by names, possibly several per block.
    for role in ROLE_LABELS:
        pat = rf">{role}\s*<.{0,4000}?(?=>(?:{'|'.join(ROLE_LABELS)})<)"
        m = re.search(pat, page, flags=re.S)
        if not m:
            continue
        chunk = m.group(0)
        names = []
        for nm in re.findall(r"<a[^>]*>([^<]{2,60})</a>", chunk):
            nm = html.unescape(nm).strip()
            if nm and nm not in names:
                names.append(nm)
        if names:
            out["roles"].append({"role": role, "names": names[:6]})

    # "Datasets used" — the scientific provenance that makes a record credible.
    i = page.find("Datasets used")
    if i > 0:
        seg = strip_tags(page[i:i + 4000])
        for ds in re.findall(r"(?:[A-Z][^|]{3,90}\[[^\]]{2,60}\])", seg):
            ds = ds.strip()
            if ds and ds not in out["datasets"]:
                out["datasets"].append(ds)
        for sens in re.findall(r"Sensor:\s*([A-Za-z0-9/_\- ]{2,40})", seg):
            tag = f"sensor: {sens.strip()}"
            if tag not in out["datasets"]:
                out["datasets"].append(tag)

    m = re.search(r"(https?://svs\.gsfc\.nasa\.gov/[^\s\"'<]+)", page)
    out["shortUrl"] = f"{SVS}/{RECORD_ID_HOLDER}/"
    return out


RECORD_ID_HOLDER = 0


def find_media_url(page: str, filename: str) -> str:
    for href in re.findall(r'href="(/vis/[^"]+)"', page):
        if href.rsplit("/", 1)[-1] == filename:
            return SVS + href
    raise SystemExit(f"media file not found on page: {filename}")


def duration_of(path: str) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=nk=1:nw=1", path])
    return float(out.strip())


def dims_of(path: str) -> tuple[int, int]:
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height", "-of", "csv=p=0", path])
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def extract_frames(video: str, out_dir: str, count: int, width: int) -> list[dict]:
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".jpg"):
            os.remove(os.path.join(out_dir, f))

    dur = duration_of(video)
    # Skip head and tail: title cards, fades, and end plates are not data.
    start = dur * 0.06
    span = dur * 0.88
    rate = count / span

    files: list[str] = []
    for attempt in range(4):
        r = rate * (1.0 + 0.02 * attempt)
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-ss", f"{start:.3f}", "-t", f"{span:.3f}", "-i", video,
             "-vf", f"fps={r:.6f},scale={width}:-2:flags=lanczos",
             "-q:v", "4", os.path.join(out_dir, "f%03d.jpg")])
        files = sorted(f for f in os.listdir(out_dir) if f.endswith(".jpg"))
        if len(files) == count:
            break
        if len(files) > count:          # trim, keeping even spacing
            keep = [files[round(i * (len(files) - 1) / (count - 1))] for i in range(count)]
            for f in files:
                if f not in keep:
                    os.remove(os.path.join(out_dir, f))
            for j, f in enumerate(keep):
                os.rename(os.path.join(out_dir, f), os.path.join(out_dir, f"k{j:03d}.tmp"))
            for j in range(count):
                os.rename(os.path.join(out_dir, f"k{j:03d}.tmp"), os.path.join(out_dir, f"f{j + 1:03d}.jpg"))
            files = sorted(f for f in os.listdir(out_dir) if f.endswith(".jpg"))
            break
        for f in files:                  # too few: retry with a faster rate
            os.remove(os.path.join(out_dir, f))

    frames = []
    step = span / max(1, len(files) - 1) if len(files) > 1 else 0
    for i, f in enumerate(files):
        frames.append({"file": f, "t": round(start + i * step, 2)})
    return frames


def poster(out_dir: str, frames: list[dict], width: int = 760) -> str:
    src = os.path.join(out_dir, frames[len(frames) // 2]["file"])
    dst = os.path.join(out_dir, "cover.jpg")
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
         "-vf", f"scale={width}:-2:flags=lanczos", "-q:v", "4", dst])
    return "cover.jpg"


# ------------------------------- main -------------------------------------

def build(rec: dict, count: int, width: int) -> dict:
    global RECORD_ID_HOLDER
    RECORD_ID_HOLDER = rec["svs"]
    rid = rec["id"]
    item_url = f"{SVS}/{rec['svs']}/"
    print(f"\n=== {rid} ({rec['title']}) — {item_url}")

    page_path = os.path.join(CACHE, f"svs_{rec['svs']}.html")
    if os.path.exists(page_path):
        page = open(page_path, encoding="utf-8", errors="ignore").read()
    else:
        page = fetch(item_url).decode("utf-8", "ignore")
        os.makedirs(CACHE, exist_ok=True)
        open(page_path, "w", encoding="utf-8").write(page)

    media_url = find_media_url(page, rec["file"])
    video = os.path.join(CACHE, rec["file"])
    if not os.path.exists(video) or os.path.getsize(video) < 100_000:
        print(f"  downloading {media_url}")
        fetch(media_url, video, timeout=1800)
    size_mb = os.path.getsize(video) / 1e6
    dur = duration_of(video)
    vw, vh = dims_of(video)
    print(f"  {size_mb:.1f} MB, {dur:.1f}s, {vw}x{vh}")

    out_dir = os.path.join(DATA, "records", rid)
    frames = extract_frames(video, out_dir, count, width)
    print(f"  {len(frames)} frames")
    cover = poster(out_dir, frames)

    credits = parse_credits(page)
    credits["shortUrl"] = item_url
    credits["mediaUrl"] = media_url
    credits["video"] = {"duration": round(dur, 2), "width": vw, "height": vh, "mb": round(size_mb, 1)}

    entry = {
        "id": rid,
        "title": rec["title"],
        "side": rec["side"],
        "year": rec["year"],
        "blurb": rec["blurb"],
        "instrument": rec["instrument"],
        "source": {
            "title": credits.get("svsTitle", rec["title"]),
            "agency": "NASA Scientific Visualization Studio (EIC Content Database)",
            "url": item_url,
            "credit": credits["credit"],
            "roles": credits["roles"],
            "datasets": credits["datasets"][:6],
            "video": credits["video"],
        },
        "cover": f"records/{rid}/{cover}",
        "frames": [
            {"src": f"records/{rid}/{f['file']}", "t": f["t"], "n": i + 1}
            for i, f in enumerate(frames)
        ],
    }
    with open(os.path.join(out_dir, "frame.json"), "w", encoding="utf-8") as fh:
        json.dump(entry, fh, indent=2)
    return entry


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--frames", type=int, default=18)
    ap.add_argument("--width", type=int, default=1280)
    args = ap.parse_args()

    wanted = [r for r in RECORDS if not args.only or r["id"] in args.only]
    wanted_gibs = [r for r in GIBS_RECORDS if not args.only or r["id"] in args.only]
    out = []
    for rec in wanted:
        try:
            out.append(build(rec, args.frames, args.width))
        except Exception as e:  # keep going: one bad record must not sink the album
            print(f"  !! {rec['id']}: {e}", file=sys.stderr)
    for rec in wanted_gibs:
        try:
            print(f"\n=== {rec['id']} ({rec['title']}) — NASA GIBS {rec['gibs']}")
            out.append(build_gibs(rec, args.frames, args.width))
        except Exception as e:
            print(f"  !! {rec['id']}: {e}", file=sys.stderr)

    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "records.json")
    existing = {}
    if os.path.exists(path):
        try:
            existing = {r["id"]: r for r in json.load(open(path, encoding="utf-8"))["records"]}
        except Exception:
            existing = {}
    for e in out:
        existing[e["id"]] = e
    order = [r["id"] for r in (RECORDS + GIBS_RECORDS) if r["id"] in existing]
    catalog = {"generated": True, "records": [existing[i] for i in order]}
    json.dump(catalog, open(path, "w", encoding="utf-8"), indent=2)

    # The same catalog as a plain script, so index.html works when opened
    # straight from disk: no fetch, no server, no CORS.
    js_path = os.path.join(DATA, "records.js")
    with open(js_path, "w", encoding="utf-8") as fh:
        fh.write("/* generated by tools/build_library.py — do not edit */\n")
        fh.write("window.JUKEBOX_DATA = ")
        json.dump(catalog, fh, indent=2)
        fh.write(";\n")
    print(f"\nwrote {path} and {js_path} with {len(catalog['records'])} records")


if __name__ == "__main__":
    main()
