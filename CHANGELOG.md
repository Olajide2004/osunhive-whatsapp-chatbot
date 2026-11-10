# Changelog

## v2.0.0 — Final cloud release (2026-11-10)

Osunhive Chatbot v2.0.0 — Baileys 7-rc based WhatsApp automation bot.
Source-only cloud VPS package (no node_modules, no session keys).

### Highlights
- **Meta AI persona replies** — bold headline, `•` bullets, follow-up suggestions,
  `— 🔷 Osunhive AI` signature + source link, progressive "streaming" edits with
  a fence-safe chunker (`lib/metaStyle.js`).
- **Interactive list menus** — `.menu` renders single_select lists; every section
  has a ⬅️ Back to Menu row (`commands/help.js`, `lib/button.js`).
- **Polls** — `.poll Question? | A | B`, multichoice (`multi`), live vote tracking
  (decrypts ballots), `.poll list`, `.poll results`, `.poll delete`.
- **Status auto-poster** — media/text rotation, bg color, font, interval, recipient
  discovery (LID→phone mapping), per-chat enable, `.autopoststatus` (+ aliases
  `.autostatuspost`, `.statuspost`, `.autopost`).
- **Link unfurling** — `.unfurl <url>` on demand, `.linkpreview on|off` for
  automatic OpenGraph preview cards on incoming URLs (`lib/linkPreview.js`).
- **Voice notes** — `.voice <text>` (TTS → libopus PTT), `.autoreply voice on`
  reads the first sentence of each AI reply aloud (`lib/feedback.js`,
  `lib/ttsAudio.js`, `commands/voice.js`).
- **Reactions** — `.react`, `.autoreply react on|off` (heart), `.autopoststatus react on|off`.
- **Scheduled tasks** — `.schedule add|list|remove|enable|disable` with
  `every N m|h|d`, `hourly`, `daily HH:MM`; supports text / voice / status
  (`lib/scheduler.js`, `commands/schedule.js`).
- **Per-sender rate limiting** on auto-reply (`lib/ratelimit.js`).
- **vCard, polls, antidelete, anticall, PM blocker, autoread, antitag, antilink,
  group status, greetings** and more existing functionality retained.

### Fixes
- Auto-reply never answers the owner's own messages.
- Group spam protection: `groupReply off|mention|all`, per-group cooldown.
- Status recipients are phone-number JIDs only (`@lid` recipients terminate the stream).
- `.autostatus` hints when called with poster flags; poster runs before the loose
  status match; delete-after-post stores the status id.
- Streaming never splits fenced code blocks; edit-failure falls back to one full send.
- Graceful shutdown: SIGTERM/SIGINT (`deploy/stop.sh`, systemd `KillSignal=SIGTERM`);
  never `kill -9`.
- Owner list corrected to `["2349076129380"]` in `data/owner.json`.

### Notes for deployers
- Package excludes `node_modules/`, `session/`, `temp/`, `.git/`, logs, `.env`,
  `baileys_store.json`. Run `pnpm install` (or `npm install`) on the VPS.
- `data/messageCount.json` ships as an empty template — fresh state on first boot.
- See `USAGE.md` (end users), `deploy/README.md` (VPS), `docs.md` (internals).
- Requires `ffmpeg` for voice notes/media; Node 18+; outbound network.

### Known limitations
- 3rd-party "quick-reply" buttons may not fire on all WhatsApp clients — list menus
  are used for navigation instead.
- Hard-coded free-tier API keys (shizoapi/princetech) are embedded for joke/fun/AI
  helpers — consider replacing with paid keys for production.
- Group scans (`groupFetchAllParticipating`) are timeout-guarded and skipped while
  the socket is closed; status recipient discovery depends on LID mappings or an
  explicit recipient list.
