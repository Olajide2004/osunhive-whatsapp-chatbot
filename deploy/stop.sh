#!/usr/bin/env bash
# Stop the bot gracefully so Baileys can flush session writes.
# Never use `kill -9` — it can corrupt signal keys ("Bad MAC") and force re-pairing.

cd "$(dirname "$0")/.."

PIDS=$(pgrep -f "node index\.js" || true)

if [ -z "$PIDS" ]; then
    echo "Bot is not running."
    exit 0
fi

echo "Sending SIGTERM to: $PIDS"
kill $PIDS 2>/dev/null || true

for _ in $(seq 1 20); do
    if ! pgrep -f "node index\.js" >/dev/null 2>&1; then
        echo "Stopped cleanly."
        exit 0
    fi
    sleep 1
done

echo "Still running after 20s; sending SIGKILL (last resort)."
pkill -9 -f "node index\.js" || true
