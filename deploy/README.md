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
node scripts/run-tests.js      # every offline suite (12 of them)
node scripts/run-tests.js --list
node scripts/run-tests.js health   # only matching suites
```

## 9. Docker (any VPS, Fly.io, Railway, Koyeb…)

The image installs ffmpeg, uses Node 22 and keeps WhatsApp auth keys on a
volume. **The volume is the pairing** — delete it and you must link again.

```bash
cp .env.example .env          # set BOT_PHONE_NUMBER=<bot number, digits only>
docker compose up -d --build
docker compose logs -f        # pairing code shows up here on first run
```

First run: watch the logs, then enter the pairing code in
**WhatsApp → Linked devices → Link with phone number**.

```bash
docker compose restart        # keep the same session
docker compose up -d --build  # update the code, session survives
docker compose down           # stop (volume kept)
docker compose down -v        # stop AND unpair (deletes the volume)
```

`.update` inside a container is pointless — the image is the deployment. Pull
the new source and rebuild instead.

Health check: `http://<host>:10000/healthz` → `{"ok":true,"connected":true,…}`.
`PORT` and `SESSION_DIR` are honoured, so the same image works on Render,
Railway, Koyeb and Fly (mount a volume at `/data`).

## 10. Render (Blueprint)

`render.yaml` in the repo root defines the service: Docker runtime, health
check on `/healthz`, and a **1 GB disk at `/data`** for the session.

1. Render Dashboard → **New → Blueprint** → pick this repository.
2. When prompted, set `BOT_PHONE_NUMBER` (digits only, no `+`).
3. Deploy, then open **Logs** and read the pairing code.
4. WhatsApp → Linked devices → Link with phone number.

| | Free | Starter (~$7/mo) |
|---|---|---|
| Sleeps after 15 min idle | ✅ yes (socket dies) | ❌ never |
| Persistent disk for `session/` | ❌ not available | ✅ 1 GB |
| Re-pair needed | after every sleep/deploy | only once |

So: **free Render = demo only.** A 5-minute ping to `/healthz`
(cron-job.org / UptimeRobot) keeps a free service awake, but Render still
restarts free instances and without a disk the pairing is lost — you would
have to link again each time. For genuine free 24/7 use the Oracle VM in §12.

## 11. GitHub Codespaces (testing only)

`.devcontainer/devcontainer.json` makes Codespaces a one-click sandbox:

1. Repo → **Code → Codespaces → Create codespace on main** (deps install
   automatically).
2. In the terminal: `BOT_PHONE_NUMBER=<number> node index.js`.
3. Enter the pairing code from the terminal in WhatsApp.

Codespaces **stops after ~30 minutes idle** and the free tier is ~60 h/month
on 2 cores, so it is for testing, not hosting. The container is thrown away
and `session/` does not survive.

## 12. Free / cheap hosts

| Host | Free? | Verdict for a WhatsApp bot |
|---|---|---|
| **Oracle Cloud Always Free** | ✅ always | Best free option: 4 ARM cores / 24 GB RAM + 200 GB disk. Card verification required; ARM capacity can be scarce (retry, or try another availability domain). Use §1–5 (systemd) or §9 (Docker). |
| **Google Cloud free tier** | ✅ 1 × e2-micro | Real 24/7 VM, small, 1 GB egress/month — heavy media use may exceed it. |
| **Azure free account** | 12 months B1s + credit | Fine for a year, then paid. |
| **AWS free tier** | ⚠️ credits | Since 2025 it is credit-based, not a free year — read the terms. |
| **Render free** | ✅ but sleeps | Demo only (see §10). |
| **Railway / Fly.io / Koyeb** | 💳 trial/paid | Excellent, but not free forever; Railway gives a small trial credit. |
| **GitHub Student Pack** | ✅ credits | $200 DigitalOcean, Azure credit, etc. — best value if you have a student account. |
| **GitHub Actions / Pages** | ❌ | 6-hour job limit, no persistent disk, and hosting is against the ToS. |

> ⚠️ Free-VPS offers shared in WhatsApp groups are frequently trials,
> crypto-mining boxes or credential harvesters. Never paste your WhatsApp
> **session folder**, pairing code or bot credentials into a host you do not
> control — those keys are the account.

Ensure the final zip includes:
- `lib/scheduler.js`, `commands/schedule.js`
- `lib/polls.js`, `commands/poll.js`, `lib/linkPreview.js`, `commands/unfurl.js`
- `lib/health.js`, `Dockerfile`, `docker-compose.yml`, `render.yaml`, `.devcontainer/`
- All updated files (`main.js`, `index.js`, `commands/autotyping.js`, `commands/help.js`, `docs.md`)
