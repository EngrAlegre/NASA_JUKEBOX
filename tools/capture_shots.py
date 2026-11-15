"""Capture the deck's screenshots with a server that lives exactly as long as we need.

The long-running `tools/serve.py` gets reaped when its launching shell goes away,
which is why half an earlier batch came back as "127.0.0.1 refused to connect".
Here the server is a child of this process, so its lifetime is this script's.

    python tools/capture_shots.py     # -> .cache/shots/*.png
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8199
BASE = f"http://127.0.0.1:{PORT}/"
OUT = os.path.join(ROOT, ".cache", "shots")

SHOTS = [
    ("hero",      "?r=nightlights", 1600, 900, 7000),
    ("shelf",     "",               1600, 900, 5000),
    ("method",    "",               1600, 900, 6000),
    ("liner",     "",               1600, 900, 6000),
    ("desc",      "?r=nightlights", 1600, 900, 8000),
    ("lightning", "?r=lightning",   1600, 900, 9000),
]


def up(deadline=20):
    t0 = time.time()
    while time.time() - t0 < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "tools/serve.py", "--port", str(PORT), "--no-browser"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not up():
            print("server never came up", file=sys.stderr)
            return 1

        results = []
        for name, query, w, h, wait_ms in SHOTS:
            png = os.path.join(OUT, f"{name}.png")
            env = dict(os.environ, SHOT_W=str(w), SHOT_H=str(h))
            cmd = ["node", "tools/shoot.js", BASE + query, png, str(wait_ms)]
            expr = os.path.join(OUT, f"{name}.js")
            if os.path.exists(expr):
                cmd.append("@" + expr)
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=env)
            ok = os.path.exists(png)
            detail = ""
            if ok:
                try:
                    payload = json.loads(r.stdout)
                    detail = (payload.get("eval") or payload.get("pageErrors") or "")[:70]
                except Exception:
                    detail = r.stdout.strip()[:70]
            results.append((name, ok, os.path.getsize(png) if ok else 0, detail))
            print(f"{name:<10} {'ok' if ok else 'FAIL':<4} {results[-1][2]:>7} b  {detail}")
        return 0 if all(r[1] for r in results) else 1
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()


if __name__ == "__main__":
    sys.exit(main())
