#!/usr/bin/env bash
# Serve dist/ on 8199 and check the packed folder is complete and working.
#   bash tools/checks/dist.sh
set -u
cd "$(dirname "$0")/../.." || exit 1

python -m http.server 8199 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SERVER=$!
sleep 2

node tools/shoot.js "http://127.0.0.1:8199/" ".cache/shot-dist.png" 9000 \
  "JSON.stringify({records:document.querySelectorAll('.record').length,bars:document.querySelectorAll('.filmstrip button').length,audio:!!document.querySelector('audio'),title:document.querySelector('#rec-title').textContent})"

STATUS=$?
kill "$SERVER" 2>/dev/null
wait "$SERVER" 2>/dev/null
exit "$STATUS"
