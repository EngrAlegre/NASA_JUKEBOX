#!/usr/bin/env bash
# Regenerate the hero screenshot and the social card.
#   bash tools/checks/og.sh
set -eu
cd "$(dirname "$0")/../.." || exit 1
node tools/shoot.js "http://127.0.0.1:8177/?r=ocean" "docs/screenshot.png" 9000
SHOT_W=1240 SHOT_H=760 SHOT_CLIP=1200x630 \
  node tools/shoot.js "http://127.0.0.1:8177/tools/og-card.html" "og.png" 2500
