#!/bin/sh
# The fly-through in a window.   tools/demo.sh [night|day|dusk] [x,z]
# Click to capture the pointer (Esc lets go): mouse to look, W A S D to move, Space / E up, C / Q down, Shift faster,
# the wheel scales the speed.
set -e
cd "$(dirname "$0")/.."
room="tokyo-${1:-night}"
[ -n "$2" ] && room="$room-at=$2"
node tools/bundle.ts >/dev/null
# (the scene keeps the arrays of the cells it has in: more than the script's default 1 GiB)
THREERT_SCRIPT_MB=12288 exec ./engine/renderer/target/release/threert-render play out/bundles/city.js --assets . --room "$room" --width 1920 --height 1080
