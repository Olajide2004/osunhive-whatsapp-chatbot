# Changelog

## Unreleased

### Added
- **Repo automation (`.github`)** — CI runs syntax checks, the 11 offline test
  suites (Node 20/22) and a source-package leak scan; a tag-driven **Release**
  workflow builds the source archives; plus issue/PR templates, `SECURITY.md`,
  `FUNDING.yml`, Dependabot and `CODEOWNERS`. `pnpm test` now runs
  `scripts/run-tests.js`.
- **Holiday countdown & fireworks** — `.countdown` shows the days to 🎄 Christmas,
  🎆 New Year and 🌙 Ramadan (fasting); `.countdown christmas|newyear|ramadan`
  zooms in on one. `.fireworks [text]` sends an animated 🎆 fireworks message
  that cycles through frames (message edits) with your own greeting.
  (`commands/celebrate.js`, `main.js`)
- **Disclaimer & credit** — a ⚠️ warning blockquote lives at the top of the
  **README only**: *unofficial / not affiliated with WhatsApp or Baileys*, with
  💬 WhatsApp, 🧩 Baileys and 🧠 Osunhive credited. It was deliberately kept out
  of the bot's runtime output. (`README.md`)
- **CDN browser buttons** — `.cdn` listings now ship interactive buttons:
  `📂 #n` / `📤 #n` shortcuts, `⬆️ Up`, `🏠 Root`, `🔄 Refresh`, `➡️ Page n`
  and a `🌐 Osunhive` link. Toggle with `.cdn buttons on|off`.
  (`commands/cdn.js`, `main.js`)
- **CDN browser** — `.cdn` browses the Osunhive CDN
  (https://cdn.osunhive.name.ng) from WhatsApp with **folder-path navigation**:
  `.cdn <n>` opens a folder or posts a media file, `.cdn <folder/path>` opens a
  named path (the CDN resolves `foldername/foldername/`), `.cdn ..`/`.cdn root`
  move around, and `.cdn send|link|info <n>`, `.cdn page <n>`, `.cdn refresh`
  handle files. Listings are cached per folder. (`commands/cdn.js`)
- **Direct-link status posting** — `.autostatuspost <direct-link.mp4>` (or
  `.autopoststatus <url>`, `.autopoststatus now <url>`, with an optional
  `| caption`). Type is taken from the file extension, then the server's
  `Content-Type`; files over 80 MB are rejected. (`commands/autopoststatus.js`)
- **Osunhive CDN links** — `cdn:<fileId>` shorthand and
  `https://cdn.osunhive.name.ng/<fileId>` are auto-resolved to the
  `/download/<fileId>` endpoint; type comes from `Content-Type`.
- **Action buttons on auto-replies** — every AI answer under 900 characters now
  ships a 🌐 website link button plus 📋 Menu and 📦 Products quick replies
  (`.autoreply buttons on|off`). Streaming is skipped for short replies so the
  buttons are always delivered.
- **New commands** — `.products` / `.shop` / `.store` (Osunhive catalogue) and
  `.website` / `.links` / `.socials` (all official channels), with a
  🛍️ Osunhive section in the interactive menu.

### Fixed
- **Antidelete media crash** — `downloadContentFromMessage` returns a stream
  in Baileys 7, but the code passed it straight to `fs.writeFile`
  (`ERR_INVALID_ARG_TYPE`), so deleted images/videos/stickers/audio/view-once
  were never captured. Media is now buffered from the stream, with a 64 MB
  cap, and a failed download no longer loses the message text.
  (`commands/antidelete.js`)
- **Antidelete reports went to the bot's own number** instead of the owner —
  they now go to `settings.ownerNumber` (falling back to the bot). Also hardened:
  guards for missing keys/`sock.user`, group-metadata failures, protocol
  messages are not stored, status/newsletter traffic is skipped, and the
  in-memory store is capped at 500 entries / 24 h with temp-media cleanup.
- **`.update` no longer needs an external unzip tool** — when the bot is a
  source-only install (no `.git`) and the device has no `unzip`/`7z`/`busybox`,
  the ZIP is now unpacked by a **built-in pure-Node ZIP reader** (`zlib`), so
  updates succeed on bare hosts. It handles stored and deflated entries, ZIP64,
  directory entries and blocks path-traversal names. (`commands/update.js`)
- **`.update check` now really compares commits** — it reads the local `HEAD`,
  queries the repo from `origin` (not a hardcoded upstream), reports local vs
  remote SHAs and how many commits behind you are, and distinguishes
  "up to date", "update available" and "local ahead (unpushed)". GitHub API
  errors are surfaced instead of being reported as "up to date".
  (`commands/update.js`)
- **`.update` ZIP fallback** now downloads from the repo it was cloned from
  (derived from `origin`) instead of a fixed upstream URL.
- Button-id routing: `ar_menu`, `ar_product`, `ar_website`, `ar_offline` now
  resolve to real commands (previously dead two-step mappings).

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
