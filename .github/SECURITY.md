# 🔐 Security policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via either:

- GitHub → **Security** tab → **Report a vulnerability** (preferred), or
- Email the maintainer through https://www.osunhive.name.ng

Include: affected version/commit, a description, and (if possible) steps to
reproduce. We aim to acknowledge within a few days.

## Scope

This is an **unofficial** WhatsApp automation project. It is **not affiliated
with WhatsApp LLC, Meta Platforms, Inc. or the Baileys project**.

## Never commit

| Never commit | Why |
| --- | --- |
| `session/` | Contains WhatsApp auth keys — anyone with it can take over the account. |
| `baileys_store.json` | Session/message store. |
| `.env` / `.env.*` | API keys and secrets. |
| `data/userName.json`, `data/messageCount.json`, `data/premium.json`, `data/cdnCache.json`, `data/cdnState.json` | Runtime state that may contain JIDs / LIDs / phone numbers. |

If you accidentally pushed any of these, **re-pair the bot immediately**
(delete `session/`, restart, re-link) and rotate any exposed API keys.

## Supported versions

Security fixes land on `main`; the latest release is supported.