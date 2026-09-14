#!/bin/sh
set -eu

xdpyinfo -display :1 >/dev/null
curl -sf http://127.0.0.1:9222/json/version >/dev/null
curl -sf -u "viewer:${COMPUTER_VIEWER_PASSWORD:?}" http://127.0.0.1:6901/ >/dev/null
