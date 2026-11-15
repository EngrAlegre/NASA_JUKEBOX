"""Capture every shot the 60-second cut needs, from one server, one run."""
import json
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8199
os.chdir(ROOT)

# (dir, record, seconds, actions-file or None)
TAKES = [
    ("l-a", "co2",        "13", None),
    ("l-b", "canopy",     "8",  None),
    ("l-c", "lightning",  "8",  None),
    ("l-d", "ocean",      "8",  None),
    ("l-e", "nightlights", "8", None),
    ("l-f", "co2",        "17", ".cache/actions-features.js"),
]


def up(deadline=25):
    t0 = time.time()
    while time.time() - t0 < deadline:
        try:
            socket.create_connection(("127.0.0.1", PORT), timeout=0.5).close()
            return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    srv = subprocess.Popen(
        [sys.executable, "tools/serve.py", "--port", str(PORT), "--no-browser"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not up():
            print("server never came up", file=sys.stderr)
            return 1
        for name, rec, secs, actions in TAKES:
            cmd = ["node", "tools/record.js", f"http://127.0.0.1:{PORT}/?r={rec}",
                   f".cache/vid/{name}", secs, "--play"]
            if actions:
                cmd.append(f"--actions={actions}")
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=400,
                               env=dict(os.environ, REC_W="1600", REC_H="900"))
            timing_path = f".cache/vid/{name}/timing.json"
            if not os.path.exists(timing_path):
                print(f"{name}: FAILED {r.stderr.strip()[:160]}")
                continue
            t = json.load(open(timing_path, encoding="utf-8"))
            playing = all(row[3] == 1 for row in t["samples"])
            clocks = [row[0].split(" /")[0] for row in t["samples"]]
            print(f"{name:6} {rec:11} {t['fps']:>5} fps  playing={playing}  "
                  f"{clocks[0]} -> {clocks[-1]}  {' '.join(sorted({row[1] for row in t['samples']}))[:60]}")
            if r.stderr.strip():
                print("        warn:", r.stderr.strip()[:160])
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
