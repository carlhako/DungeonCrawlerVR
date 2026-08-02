#!/usr/bin/env bash
#
# Start the dev server for headset testing.
#
#   ./start.sh          HTTPS on :5173 — what the Quest 3 needs
#   ./start.sh http     plain HTTP — desktop only, no VR (navigator.xr doesn't exist)
#
# Runs in the foreground so you can see the log and stop it with Ctrl-C. WebXR needs a
# secure context, and the Quest is a different machine from this one, so LAN access has to
# be HTTPS — hence the self-signed certificate you'll be asked to accept once per headset.

set -euo pipefail
cd "$(dirname "$0")"

PORT=5173
MODE="${1:-https}"

# Refuse to start on top of an existing server rather than silently landing on port 5174 and
# leaving you loading the old build in the headset, wondering why nothing changed.
if command -v lsof >/dev/null 2>&1 && lsof -i ":$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Something is already listening on port $PORT:"
  lsof -i ":$PORT" -sTCP:LISTEN
  echo
  echo "Stop it first:  kill \$(lsof -i :$PORT -sTCP:LISTEN -t)"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# The address to type into the Quest browser. Falls back quietly if `hostname -I` isn't
# available — the server prints its own URLs a moment later anyway.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')" || LAN_IP=""

if [ "$MODE" = "http" ]; then
  echo "Starting HTTP dev server (desktop only — VR needs HTTPS)"
  [ -n "$LAN_IP" ] && echo "  http://$LAN_IP:$PORT"
  echo
  exec npm run dev
fi

echo "Starting HTTPS dev server for the Quest 3"
[ -n "$LAN_IP" ] && echo "  https://$LAN_IP:$PORT   <- open this in the headset browser"
echo "  Accept the self-signed certificate warning once per device."
echo
exec npm run dev:xr
