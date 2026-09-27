#!/usr/bin/env bash
# Builds the app, serves the production build on :4173 and opens an ngrok tunnel to it.
# Usage: npm run share        (start / restart, prints the public URL)
#        npm run share:stop   (stop the server and the tunnel)
# Optional: NGROK_URL=your-name.ngrok-free.app npm run share   (use your reserved ngrok domain)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run

stop() {
  pkill -f "vite preview" 2>/dev/null || true
  pkill -f "ngrok http 4173" 2>/dev/null || true
}

if [[ "${1:-}" == "stop" ]]; then
  stop
  echo "Stopped the preview server and the ngrok tunnel."
  exit 0
fi

stop
npm run build --silent
setsid nohup npx vite preview > .run/preview.log 2>&1 < /dev/null &
if [[ -n "${NGROK_URL:-}" ]]; then
  setsid nohup ngrok http 4173 --url="$NGROK_URL" --log stdout > .run/ngrok.log 2>&1 < /dev/null &
else
  setsid nohup ngrok http 4173 --log stdout > .run/ngrok.log 2>&1 < /dev/null &
fi

for _ in $(seq 1 30); do
  url=$(curl -s -m 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(t[0]['public_url'] if t else '')" 2>/dev/null || true)
  if [[ -n "$url" ]] && curl -s -m 5 -o /dev/null http://127.0.0.1:4173/; then
    echo "Local:  http://127.0.0.1:4173/"
    echo "Public: $url"
    echo "(Visitors first see an ngrok notice page — click \"Visit Site\".)"
    exit 0
  fi
  sleep 1
done
echo "Tunnel did not come up — see .run/ngrok.log" >&2
exit 1
