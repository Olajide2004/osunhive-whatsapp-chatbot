#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

# Optional: override the WhatsApp number
export BOT_PHONE_NUMBER="${BOT_PHONE_NUMBER:-<PHONE_NUMBER>}"

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    if command -v pnpm >/dev/null 2>&1; then
        pnpm install
    else
        npm install
    fi
fi

echo "Starting Osunhive Bot on $BOT_PHONE_NUMBER ..."
exec node index.js --pairing-code
