#!/usr/bin/env python3
"""
Serve the jukebox.

The app reads pixels out of a canvas, and browsers refuse to expose pixel data
for images loaded from `file://` (the page's origin is opaque, so every image
counts as cross-origin). One command fixes that, with no dependencies:

    python tools/serve.py            # http://127.0.0.1:8177
    python tools/serve.py --port 9000 --no-browser

Also works as a plain static server for anything else in the folder.
"""

import argparse
import functools
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Correct types for the two things a browser is fussy about here.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".webp": "image/webp",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        # No caching while iterating on the app; instant reloads matter more than
        # bandwidth on localhost.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            sys.stderr.write("  %s\n" % (fmt % args))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8177)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True

    port = args.port
    for attempt in range(20):
        try:
            httpd = socketserver.TCPServer((args.bind, port), handler)
            break
        except OSError:
            port += 1
    else:
        raise SystemExit("no free port found")

    url = f"http://{args.bind}:{port}/"
    print(f"\n  The Earth Information Jukebox\n  {url}\n  serving {ROOT}\n  ctrl-c to stop\n")

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped\n")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
