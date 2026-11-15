#!/usr/bin/env bash
# Headless check of the guided tour. Run: bash tools/checks/tour.sh [seconds]
# Kept in a file because long inline command lines get elided by the shell wrapper.
set -u
cd "$(dirname "$0")/../.." || exit 1
WAIT="${1:-16000}"
node tools/shoot.js "http://127.0.0.1:8177/?tour=1" ".cache/shot-tour.png" "$WAIT" "@.cache/tour-expr.js"
