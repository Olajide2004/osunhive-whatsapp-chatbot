# Osunhive Chatbot Feature Guide

> For end-user instructions (permissions, commands, auto-reply, status posting)
> see **`USAGE.md`** in the project root.

## Features (released v2)

### 1. Message reactions
Bot can react to its own messages or other bot messages:
- `.react on|off` — react heart to every bot reply to a user's message
- `.react [emoji]` — react with a specific emoji to the quoted message

### 2. Per-sender rate limiting (auto-reply)
The auto-reply engine now tracks one sender per window and throttles floods:
- Default: max 5 messages / 60 s, then the sender waits 4 s between replies
- `.autoreply cooldown <seconds>` sets the per-sender reply gap
- Owner/sudo messages are never rate-limited; group reply also throttled by chat ID

### 3. Meta AI persona
Replies are formatted like a Meta AI answer when `replyStyle === 'meta'`:
- bold headline (first sentence auto-wrapped), • bullets, tight spacing
- 3 suggested follow-up questions (topic-matched)
- `— 🔷 *Osunhive AI*` signature + source link
- optional progressive stream via message edits (`▍` cursor removed at end)

Enable:
```
.autoreply meta on
.autoreply stream on
.autoreply suggest on
.autoreply sources on
```

### 4. Polls
Create, vote, track and view poll results:
```
.poll Question? | Option A | Option B     # single choice
.poll multi Question? | A | B | C          # multiple choice
.poll count:2 Question? | A | B | C | D    # up to 2 votes per person
.poll results <id>                        # live aggregated results
.poll list                                 # recent polls tracked
.poll delete                               # reply to a poll to delete it
```
Votes are collected live from incoming WhatsApp poll update events; the bot
decrypts each ballot with Baileys' `decryptPollVote` so vote counts stay
accurate across restarts.

### 5. Link unfurling
`.unfurl <url>` fetches OpenGraph metadata and renders a preview card next to
the quoted link. `.linkpreview on` makes the bot unfurl **every incoming URL**
automatically (owner-only toggle; runs before other message handling).

### 6. Voice-note replies
`.autoreply voice on` makes the bot read the first sentence of every AI reply
out loud as a short voice note. Uses gTTS → libopus encoding (already a
dependency). `.voice <text>` sends an ad-hoc text-to-voice voice note.

### 7. Scheduled tasks
`.schedule add <target> <schedule> action text` creates a recurring task:
```
.schedule add here every 30m text Reminder: do X
.schedule add here daily 08:30 text Good morning
.schedule add here daily 08:30 voice Time for standup
.schedule add status daily 09:00 text Fresh article online
.schedule add <PHONE_NUMBER>@s.whatsapp.net every 1h text Check in
.schedule list                         # show all scheduled tasks
.schedule remove <id>                 # delete a task
.schedule enable|disable <id>          # toggle a task
.schedule clear-all                    # remove every task
```
Actions supported: `text`, `voice`, `status` (always posts to `status@broadcast`).
Schedules: `every <N>m|h|d`, `hourly`, `daily HH:MM` (24h). Tasks persist
across restarts; the bot re-runs due tasks every 30 seconds.

## Testing
All feature tests live in this project root:
- `test-meta-style.js` — Meta AI persona helpers
- `test-autoreply-format.js` — copy-box + classic formatting
- `test-autopoststatus.js` — auto-poster at scale
- `test-polls.js` — poll register / encrypt / decrypt / aggregate
- `test-scheduler.js` — schedule parsing + formatting
