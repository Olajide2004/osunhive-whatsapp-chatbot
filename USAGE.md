# Osunhive Chatbot — Usage Guidelines

A complete guide to using the Osunhive WhatsApp bot: permissions, commands,
auto-reply, status posting, scheduling and moderation.

- **Bot name:** Osunhive Chatbot · **Version:** 2.0.0
- **Owner number:** `2349076129380`
- **Website:** https://www.osunhive.name.ng
- **Test number (staging):** `<PHONE_NUMBER>`

> The bot replies to commands that start with a **dot** (`.`). Plain text is
> handled by the auto-reply engine only when it is switched on.

---

## 1. Getting started

1. Start the bot (see `deploy/README.md` for a cloud VPS walkthrough).
2. Scan the QR/pairing code from the owner's WhatsApp once.
3. In any chat, send:

```
.menu
```

The bot sends an **interactive menu** (WhatsApp list). Tap *Open Menu* and pick
a category. Every section has a *⬅️ Back to Menu* row.

Text equivalents:

```
.menu              # interactive category list
.menu all          # every command as text
.menu general      # one section (general, admin, owner, media, ...)
.help              # alias of .menu
```

---

## 2. Permissions & modes

| Level | Who | Can do |
|-------|-----|--------|
| **Owner** | `settings.ownerNumber` and numbers in `data/owner.json` | Everything, including owner-only commands and bot settings |
| **Sudo** | Extra numbers added to the owner list | Same as owner for most commands |
| **Admin** | Group admins (and the bot, when it is an admin) | Moderation: ban, mute, promote, antilink, tag… |
| **Everyone** | Any chat participant | General, media, AI, downloader, games, fun commands |

### Bot mode

```
.mode public      # everyone can use the bot (default)
.mode private     # only owner/sudo get responses
```

In **private** mode every non-owner message is ignored. In groups, moderation
still runs and commands work for members in **public** mode.

---

## 3. Auto-reply (the AI assistant)

The auto-reply engine answers non-command messages. It is **off by default** —
turn it on with:

```
.autoreply on
```

### Replying policy in groups

```
.autoreply group off       # never reply in groups (default)
.autoreply group mention   # only reply when @mentioned or replied to
.autoreply group all       # reply to every group message
.autoreply cooldown 8      # 8s minimum between replies per group
```

Outside groups (1-to-1 chats) the bot always answers when auto-reply is on,
subject to the per-sender rate limit (see §4).

### Response style — Meta AI persona

```
.autoreply meta on         # Meta-AI look: bold headline, • bullets, follow-ups, footer
.autoreply meta off        # classic plain answer
.autoreply stream on       # answer appears progressively (typing/editing effect)
.autoreply suggest on      # append 3 suggested follow-up questions
.autoreply sources on      # append "— 🔷 Osunhive AI" + website link
.autoreply buttons on      # add 🌐 Website + 📋 Menu + 📦 Products action buttons (default on)
.autoreply buttons off     # plain text replies (no buttons)
```

> **Action buttons:** when enabled, each reply carries a **🌐 Osunhive** website
> link button plus **📋 Menu** and **📦 Products** quick replies. Buttons are sent
> only for replies under 900 characters; longer answers are streamed as text.
> Tapping **📋 Menu** opens the command menu, **📦 Products** shows the Osunhive
> catalogue, and the website button opens `osunhive.name.ng`.

A Meta-style reply looks like:

```
*Osunhive is a digital learning hub founded in Nigeria.*

Here is what you get:

• Free beginner-friendly tutorials
• Bot building guides
• Premium blogger templates

*You might also ask* 🤔
• Show me a ready bot template
• How do I deploy a bot to a VPS?

— 🔷 *Osunhive AI*
🔗 https://www.osunhive.name.ng
```

### Code & copy boxes

```
.autoreply code on         # render code in WhatsApp monospace blocks
.autoreply copybox off     # never wrap the reply in a copy box
.autoreply copybox code    # only code blocks get a tap-to-copy box (default)
.autoreply copybox all     # every reply (prose or code) gets a copy box
```

### AI engine

The bot tries engines in order and falls back automatically:

```
.autoreply engine auto     # ChatGPT Android → BJ-GPT-OSS-20b → offline JSON (default)
.autoreply engine chatgpt  # ChatGPT Android endpoint only
.autoreply engine bjgpt    # BJ-GPT-OSS-20b API only
.autoreply engine offline  # local dataset only (no internet)
```

### Extras

```
.autoreply voice on        # also read the first sentence aloud as a voice note
.autoreply react on        # react ❤️ to the user's message after replying
.autoreply                 # toggle on/off
.autoreply off             # disable
```

### Keyword shortcuts

Even with the AI engine, these exact words return built-in answers:

`menu`, `product`, `website`, `application` / `app`, `offline`

---

## 4. Safety, limits & etiquette

- **Rate limit** — a single sender is capped (default: 5 messages/minute, with a
  ~4s gap between replies). Flooding is silently ignored.
- **Owner immunity** — the bot never auto-replies to the owner's own messages.
- **Group cooldown** — prevents the bot from spamming a busy group.
- **Command mode** — commands only fire from messages starting with `.`.
- Do **not** use the bot to spam, harass, or mass-message strangers.
- Status delivery is capped by `maxRecipients` (default 300) to protect the
  session; raise it with `.autopoststatus limit <n>`.
- Avoid `kill -9` on the process — it corrupts the session keys. Use
  `deploy/stop.sh` (SIGTERM) or `pm2 restart`.

---

## 5. Status posting (auto-poster)

Post text or media to WhatsApp Status on a schedule.

```
.autopoststatus on                     # start the scheduler
.autopoststatus off                    # stop it
.autopoststatus now [caption]          # post immediately
.autopoststatus interval 60            # minutes between posts (5–1440)
.autopoststatus text <message>         # set the single status text
.autopoststatus add <message>          # add to the rotating pool
.autopoststatus list                   # list rotation entries
.autopoststatus remove <n>             # remove pool entry n
.autopoststatus clear                  # empty the pool
.autopoststatus bg #1F2C34             # background colour (6 or 8 hex)
.autopoststatus font 1                 # font index 0–5
.autopoststatus react on|off           # ❤️ your own status
.autopoststatus preview                # preview next status as a message
.autopoststatus delete                 # delete the last posted status
.autopoststatus recipients list        # show the recipient list
.autopoststatus recipients add <num>   # add a phone number
.autopoststatus recipients remove <n>  # remove entry n
.autopoststatus recipients clear       # reset to auto-discovery
.autopoststatus limit 0                # 0 = send to everyone known
```

Aliases: `.autostatuspost`, `.statuspost`, `.autopost`.

To post a **media** status, caption a photo/video with
`.autopoststatus now`.

Manual one-off status (no scheduler): `.autostatus` / `.savestatus`.

---

## 6. Scheduled tasks

Recurring messages to a chat or to Status.

```
.schedule add here every 30m text Reminder: do X
.schedule add here daily 08:30 text Good morning
.schedule add here daily 08:30 voice Time for standup
.schedule add status daily 09:00 text Fresh article online
.schedule add 2348012345678@s.whatsapp.net every 1h text Check in
.schedule list
.schedule remove <id>
.schedule enable|disable <id>
.schedule clear-all
.schedule help
```

- Schedule kinds: `every <N>m|h|d`, `hourly`, `daily HH:MM` (24-hour).
- Actions: `text`, `voice` (voice note), `status`.
- Targets: `here` (this chat), `status`, or a full JID / phone number.
- Tasks persist across restarts.

---

## 7. General commands

```
.help / .menu          .ping          .alive         .button / .btn
.tts <text>            .voice <text>  .owner         .guide [full]
.products / .shop      .website / .links             .menu all
.joke                  .quote         .fact          .weather <city>
.news                  .attp <text>   .lyrics <song>  .8ball <q>
.groupinfo             .staff / .admins             .trt <text> <lang>
.ss <link>             .jid           .url
.poll <Q> | A | B      .poll multi    .poll results [id]
.poll list             .poll delete
.unfurl <url>          .vcard         .react [emoji]
.linkpreview on|off
.schedule ...          .voice <text>
```

Notes:

- `.poll Question? | Option A | Option B` — votes are tracked live; reply to the
  poll with `.poll delete` to remove it.
- `.unfurl <url>` previews one link on demand; `.linkpreview on` unfurls every
  incoming URL automatically.
- `.react 👍` reacts to the message you replied to.
- `.trt <text> <lang>` translates; `.voice <text>` speaks.

---

## 8. Admin / moderation commands

Require group admin (bot must be admin for actions on members).

```
.ban @user            .promote @user       .demote @user
.mute <minutes>       .unmute              .kick @user
.warn @user           .warnings @user      .delete / .del
.antilink [on/off]    .antibadword         .antitag <on/off>
.antibot <on/off/set/get>                  .clear
.tag <message>        .tagall              .tagnotadmin
.hidetag <message>    .chatbot             .welcome <on/off>
.goodbye <on/off>     .setgname <name>     .setgdesc <text>
.setgpp (reply to image)                   .groupstatus [caption]
```

---

## 9. Owner commands

```
.mode public|private        .settings            .update
.clearsession               .cleartmp            .antidelete <on/off>
.setpp (reply to image)     .autoreact <on/off>  .autoread <on/off>
.autostatus <on/off>        .autostatus react <on/off>
.savestatus [on/off]        .autotyping <on/off> .autoreply ...
.autopoststatus ...         .anticall <on/off>   .pmblocker <on/off/status>
.pmblocker setmsg <text>    .setmention (reply)  .mention <on/off>
.linkpreview on|off         .schedule ...
```

---

## 10. Media, AI, downloader & games

**Image & sticker:** `.sticker`, `.simage`, `.blur`, `.removebg`, `.remini`,
`.crop`, `.tgsticker <link>`, `.meme`, `.take <packname>`,
`.emojimix <e1>+<e2>`, `.igs`, `.igsc`.

**Textmaker:** `.metallic`, `.ice`, `.snow`, `.impressive`, `.matrix`, `.light`,
`.neon`, `.devil`, `.purple`, `.thunder`, `.leaves`, `.1917`, `.arena`,
`.hacker`, `.sand`, `.blackpink`, `.glitch`, `.fire` — each takes `<text>`.

**AI:** `.ai <q>`, `.gpt <q>`, `.gemini <q>`, `.imagine <prompt>`,
`.flux <prompt>`, `.sora <prompt>`.

**Downloader:** `.play`, `.song`, `.spotify <query>`, `.instagram <link>`,
`.facebook <link>`, `.twitter <link>`, `.tiktok <link>`, `.video <name>`,
`.ytmp4 <link>`.

**Games:** `.tictactoe @user`, `.hangman`, `.guess <letter>`, `.trivia`,
`.answer <answer>`, `.truth`, `.dare`.

**Fun / anime / misc:** `.compliment`, `.insult`, `.flirt`, `.ship`, `.character`,
`.hug`, `.kiss`, `.pat`, `.poke`, `.nom`, `.namecard`, `.tweet`, `.triggered`,
and many more — see `.menu fun`.

---

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bot doesn't answer plain text | `.autoreply on`, and check group mode/cooldown |
| Buttons/rows don't appear | WhatsApp list messages need the latest app; the bot falls back to text |
| "Bad MAC" errors | Session corrupted — restart with SIGTERM (`deploy/stop.sh`), never `kill -9` |
| Status reaches few people | Raise `.autopoststatus limit`, or add numbers with `.autopoststatus recipients add` |
| Commands ignored in a group | Group policy or owner-only mode; check `.mode` and admin rights |
| AI answers stop | Try `.autoreply engine offline` to confirm the bot/network; then restore `auto` |

---

## 12. Quick reference

```
.menu                       open the interactive menu
.autoreply on               enable the AI assistant
.autoreply group mention    reply in groups only when mentioned
.autoreply cooldown 10      throttle group replies
.autopoststatus on          start status posting
.schedule list              show scheduled tasks
.mode private               owner-only mode
.ping                       check the bot is alive
```
