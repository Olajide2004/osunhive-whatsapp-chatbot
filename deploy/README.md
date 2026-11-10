# Osunhive Chatbot — Cloud VPS Deployment

This package contains the bot **source only**. `node_modules/`, `session/`, `temp/` and `.git/` are excluded.

> For how to use the bot (commands, permissions, auto-reply, status posting),
> see **`USAGE.md`** in the project root.

## Requirements

- Ubuntu/Debian VPS (1 vCPU, 1 GB RAM minimum)
- Node.js 18+ (20 LTS recommended)
- `ffmpeg` (for audio/video/sticker commands)
- Outbound internet access (no inbound port needed)

## New in v2 — feature summary

| Feature | Command(s) |
|---------|-----------|
| Per-sender rate limit (flood protection) | `.autoreply cooldown <seconds>` |
| Meta AI persona (headline, follow-ups, sources) | `.autoreply meta on|off` |
| Streamed answers via progressive edits | `.autoreply stream on|off` |
| Follow-up suggestions after replies | `.autoreply suggest on|off` |
| Source / signature footer on replies | `.autoreply sources on|off` |
| Auto-reply voice notes (TTS → WhatsApp voice note) | `.autoreply voice on|off` |
| Auto-reply hearts after replies | `.autoreply react on|off` |
| Interactive list menus (`single_select`) | `.menu` list menus |
| Polls (create, live vote tracking, results) | `.poll Question? | A | B [| C]` |
| Recent polls listing | `.poll list` |
| Delete a poll message | `.poll delete` |
| Link unfurling (OpenGraph preview card) | `.unfurl <url>` |
| Auto link unfurling for any incoming URL | `.linkpreview on|off` |
| Voice notes (TTS → WhatsApp voice note) | `.voice <text>` |
| Scheduled tasks (recurring text/voice/status) | `.schedule add|list|remove|enable|disable` |

## 1. Upload & extract

```bash
# on the VPS
sudo mkdir -p /opt/osunhive-v2
sudo chown -R "$USER":"$USER" /opt/osunhive-v2
# upload osunhive-v2-cloud.zip, then:
cd /opt/osunhive-v2
unzip osunhive-v2-cloud.zip
```

## 2. Install system packages

```bash
sudo apt update
sudo apt install -y ffmpeg curl unzip
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
```

## 3. Install project dependencies

```bash
cd /opt/osunhive-v2
pnpm install
```

If you prefer npm:

```bash
npm install
```

## 4. First run — pair WhatsApp

```bash
cd /opt/osunhive-v2
BOT_PHONE_NUMBER=<PHONE_NUMBER> node index.js --pairing-code
```

Enter the printed pairing code in **WhatsApp → Linked Devices → Link a Device → Link with phone number**.
The `session/` folder is created after a successful link. Keep it private.

## 5. Run permanently

### Option A: systemd (recommended)

```bash
sudo nano /etc/systemd/system/osunhive.service
```

```ini
[Unit]
Description=Osunhive WhatsApp Bot
After=network.target

[Service]
WorkingDirectory=/opt/osunhive-v2
Environment=BOT_PHONE_NUMBER=<PHONE_NUMBER>
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now osunhive
sudo journalctl -fu osunhive
```

### Option B: PM2

```bash
sudo npm install -g pm2
cd /opt/osunhive-v2
BOT_PHONE_NUMBER=<PHONE_NUMBER> pm2 start index.js --name osunhive
pm2 save
pm2 startup
```

## 6. Configuration (index.js / data/autotyping.json)

The bot now ships with extra configuration knobs. Runtime toggle via chat:

```
.autoreply on              # enable auto-reply
.autoreply meta on         # Meta AI persona
.autoreply stream on       # progressive streaming
.autoreply suggest on      # follow-up questions
.autoreply sources on      # signature + link
.autoreply voice on        # read answers out loud
.autoreply react on        # heart replies
.autoreply copybox code    # code only inside copy button
.autoreply cooldown 8      # 8 seconds between replies per sender
```

## 7. Data files

```
data/autotyping.json        # auto-reply settings (meta/classic, voice, react, etc.)
data/autoPostStatus.json    # auto-poster config + recipient list + schedule
data/polls.json             # poll metadata, vote secrecy, aggregated votes
data/schedule.json          # recurring scheduled tasks
data/messageCount.json      # bot mode (public/private) + usage stats
```

## 8. Tests

```bash
cd /opt/osunhive-v2
node test-polls.js         # offline poll round-trip test
node test-scheduler.js     # schedule parser unit tests
node test-meta-style.js    # Meta AI persona unit tests
```

Ensure the final zip includes:
- `lib/scheduler.js`, `commands/schedule.js`
- `lib/polls.js`, `commands/poll.js`, `lib/linkPreview.js`, `commands/unfurl.js`
- All updated files (`main.js`, `index.js`, `commands/autotyping.js`, `commands/help.js`, `docs.md`)
