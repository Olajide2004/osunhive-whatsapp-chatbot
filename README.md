<div align="center">

![Osunhive WhatsApp Chatbot](assets/banner.svg)

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=25D366&center=true&vCenter=true&width=820&lines=Osunhive+WhatsApp+Chatbot;Learn+%E2%80%A2+Grow+%E2%80%A2+Innovate+%E2%80%A2+Earn;Interactive+menus+%7C+Meta-AI+replies+%7C+Status+poster;Free+coding+at+www.osunhive.name.ng)](https://www.osunhive.name.ng)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Baileys](https://img.shields.io/badge/Baileys-7.0.0--rc.9-25D366?style=for-the-badge)](https://github.com/WhiskeySockets/Baileys)
[![Release](https://img.shields.io/github/v/release/Olajide2004/osunhive-whatsapp-chatbot?style=for-the-badge&color=25D366)](https://github.com/Olajide2004/osunhive-whatsapp-chatbot/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Olajide2004/osunhive-whatsapp-chatbot?style=for-the-badge&color=25D366)](https://github.com/Olajide2004/osunhive-whatsapp-chatbot/stargazers)
[![Visitors](https://komarev.com/ghpvc/?username=Olajide2004&label=Visitors&color=25D366&style=for-the-badge)](https://github.com/Olajide2004/osunhive-whatsapp-chatbot)

An intelligent WhatsApp automation bot built on [Baileys](https://github.com/WhiskeySockets/Baileys) — interactive list menus, Meta-AI style auto-replies, automatic status posting, scheduling, voice notes, media tools and a full moderation suite.

</div>

---

## Features

| Area | What it does |
| --- | --- |
| **Interactive menus** | `.menu` renders native WhatsApp list menus (single-select) with a ⬅️ Back to Menu row in every section. |
| **Meta-AI replies** | Bold headline, `•` bullets, follow-up suggestions and a `— 🔷 Osunhive AI` signature, with progressive "streaming" edits that never split code blocks. |
| **Multi-engine AI** | `auto` → ChatGPT Android → BJ-GPT → offline rule engine fallback (`.autoreply engine`). |
| **Auto-reply controls** | Owner is never auto-replied; groups support `off / mention / all`, per-group cooldown and per-sender rate limiting. |
| **Voice notes** | `.voice <text>` (TTS → libopus PTT) and `.autoreply voice on` to read the first sentence of each AI answer aloud. |
| **Status posting** | `.autopoststatus on/off/now`, captions, rotation, background colour, font, recipients, delete, plus aliases. |
| **Scheduling** | `.schedule add ... every 30m|hourly|daily HH:MM` for text, voice or status messages. |
| **Polls** | `.poll Question? | A | B`, multichoice, live vote decryption, results and delete. |
| **Link unfurling** | `.unfurl <url>` on demand and `.linkpreview on|off` for automatic OpenGraph preview cards. |
| **Moderation** | ban/unban, kick, promote/demote, mute, warn, antilink, antitag, antibot, antidelete, anticall, PM blocker, welcome/goodbye. |
| **Extras** | vCard, reactions, stickers, downloads, TTS, translation, weather, jokes/quotes and more. |

Full command reference: [`USAGE.md`](USAGE.md) · Internals and testing: [`docs.md`](docs.md) · Release notes: [`CHANGELOG.md`](CHANGELOG.md)

---

## Requirements

- **Node.js 18+**
- **ffmpeg** (voice notes, media conversion, stickers)
- Internet access (WhatsApp Web + optional AI APIs)
- A WhatsApp account for the bot (a spare number is recommended)

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/Olajide2004/osunhive-whatsapp-chatbot.git
cd osunhive-whatsapp-chatbot

# 2. Install dependencies
pnpm install      # or: npm install

# 3. Configure your number (edit settings.js)
#    ownerNumber: '234XXXXXXXXXX'   <-- without "+"
#    commandMode: 'public' | 'private'

# 4. Run
node index.js
```

On first run, enter the **pairing code** shown in the terminal on the bot's phone
(WhatsApp → Linked Devices → Link with phone number), or scan the QR code.
Credentials are stored in `session/` — **never commit or share that folder.**

Set a custom pairing number without editing files:

```bash
BOT_PHONE_NUMBER=234XXXXXXXXXX node index.js
```

---

## Configuration

| Setting | Where | Notes |
| --- | --- | --- |
| `ownerNumber` | `settings.js` | Bot owner (no `+`). Owner-only commands and banner. |
| `commandMode` | `settings.js` | `public` = everyone, `private` = owner/sudo only. |
| `BOT_PHONE_NUMBER` | environment | Phone used for pairing; defaults to `ownerNumber`. |
| `session/` | runtime | WhatsApp credentials. Git-ignored. |
| `data/*.json` | runtime | Feature state and defaults. Message/premium state is git-ignored. |

Most behaviour is toggled from WhatsApp itself, e.g.:

```text
.autoreply on
.autoreply group mention
.autoreply meta on
.autoreply voice on
.autopoststatus on
.linkpreview off
```

---

## Commands (quick sample)

```text
.menu                 interactive command list
.guide [full]         quick / full usage guide
.ping  .alive         health check
.voice <text>         voice note
.poll Question? | A | B
.schedule add here every 30m text Reminder
.autopoststatus on
.autoreply on
.ban  .kick  .mute  .warn
```

See [`USAGE.md`](USAGE.md) for the complete list, permissions and examples.

---

## Deploy (VPS)

Source-only package — install dependencies on the server.

```bash
unzip osunhive-v2-2.0.0-release.zip -d /opt/osunhive-v2
cd /opt/osunhive-v2
pnpm install
node index.js
```

A systemd unit and PM2 config are provided in [`deploy/`](deploy/):

- `deploy/osunhive-bot.service`
- `deploy/ecosystem.config.js`
- `deploy/start.sh` / `deploy/stop.sh`
- `deploy/README.md` — step-by-step VPS guide

Use `SIGTERM` to stop (never `kill -9`) so the session is flushed cleanly.

---

## Project layout

```text
index.js            connection, pairing, startup banner
main.js             message routing and command dispatch
settings.js         owner, mode, version
commands/           one file per command
lib/                shared helpers (AI layout, previews, TTS, store, auth)
data/               JSON state/defaults (runtime state git-ignored)
deploy/             systemd / PM2 / scripts
test-*.js           offline test suites
```

---

## Tests

Offline suites (no WhatsApp connection needed):

```bash
node test-meta-style.js
node test-autoreply-format.js
node test-autopoststatus.js
node test-scheduler.js
node test-polls.js
```

---

## Security & limitations

- **Never commit `session/` or `baileys_store.json`** — they contain WhatsApp keys.
- `data/messageCount.json` and `data/premium.json` are runtime state and git-ignored.
- Some fun/AI helpers ship with third-party free-tier API keys inherited from the
  original scaffold. Replace them with your own keys for production use.
- Quick-reply *buttons* are unreliable on some WhatsApp clients; navigation uses
  native list menus instead.
- Automating a WhatsApp account may violate WhatsApp's Terms of Service — use a
  spare number and at your own risk.

---

## 📊 Statistics

<div align="center">

![GitHub Stats](https://github-readme-stats.vercel.app/api?username=Olajide2004&show_icons=true&include_all_commits=true&count_private=true&hide_border=true&title_color=25D366&icon_color=25D366&bg_color=0d1117&text_color=c9d1d9)

![GitHub Streak](https://github-readme-streak-stats.herokuapp.com/?user=Olajide2004&hide_border=true&background=0d1117&ring=25D366&fire=25D366&currStreakLabel=25D366&sideLabels=c9d1d9&dates=8b949e)

![Top Languages](https://github-readme-stats.vercel.app/api/top-langs/?username=Olajide2004&layout=compact&hide_border=true&bg_color=0d1117&title_color=25D366&text_color=c9d1d9)

![Activity Graph](https://github-readme-activity-graph.vercel.app/graph?username=Olajide2004&hide_border=true&bg_color=0d1117&color=25D366&line=25D366&point=ffffff&area=true)

</div>

### Project facts

| Metric | Value |
| --- | --- |
| Version | `2.0.0` |
| Engine | Baileys `7.0.0-rc.9` (Node ≥ 18) |
| Command modules | `116` |
| Library modules | `36` |
| Menu sections | `12` |
| Source lines | `~22,800` |
| Test suites | `6` offline suites |
| Release archive | ~1.7 MB (source only) |

---

## Connect with Osunhive

- 🌐 Website — [osunhive.name.ng](https://www.osunhive.name.ng)
- 🔗 Link hub — [yo.fan/osunhivetech](https://yo.fan/osunhivetech)
- ▶️ YouTube — [osunhivetech](https://www.youtube.com/channel/UCh0GXMxUUshupWAPvYkvPEA)
- 📘 Facebook — [osunhive.name.ng](https://www.facebook.com/osunhive.name.ng)
- 🐦 X / Twitter — [@Sherifhive](https://twitter.com/Sherifhive)
- 💼 LinkedIn — [osunhiveofficial](https://www.linkedin.com/in/osunhiveofficial/)
- ✈️ Telegram — [t.me/Osunhive](http://t.me/Osunhive)
- 🎵 TikTok — [osunhive.name.ng](https://www.tiktok.com/osunhive.name.ng)

---

## Credits

- 💚 Built and maintained by **Osunhive Technology** — business GitHub: [**@osunhive**](https://github.com/osunhive)
- 🎓 **Free coding at [www.osunhive.name.ng](https://www.osunhive.name.ng)**
- 🔗 All links: [yo.fan/osunhivetech](https://yo.fan/osunhivetech)
- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API
- Original bot scaffold and community libraries

<div align="center">

**[⬆ back to top](#osunhive-whatsapp-chatbot)** · Made with 💚 by [Osunhive](https://www.osunhive.name.ng)

</div>

## License

[MIT](LICENSE) © Osunhive