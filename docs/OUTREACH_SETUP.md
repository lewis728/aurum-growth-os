# Outreach autopilot — activation guide

Your autonomous outreach employee: Clay finds + enriches clinics → the agent
qualifies them → writes a personalised 5-email sequence → sends via Instantly →
when a clinic replies, the agent answers, pre-qualifies, and sends your Calendly
link → when they book, you get a WhatsApp. You never open the app.

## What runs it

- **Hourly cron** `/api/cron/outreach-autopilot` — qualifies new prospects, writes
  sequences (picking the A/B subject variant that's winning), and pushes them to
  Instantly. Once/day (06:00 UTC) it WhatsApps you a performance digest.
- **Reply webhook** `/api/outreach/reply` — Instantly calls this when a prospect
  replies. The agent classifies + auto-replies (sending your Calendly link when
  they're interested). Opt-outs / legal / hostile messages are **suppressed and
  flagged to you** — the bot never improvises into trouble.
- **Booked webhook** `/api/outreach/booked` — point your outreach Calendly event's
  webhook here; you get a "💰 new demo booked" WhatsApp.
- **WhatsApp command line** `/api/outreach/whatsapp` — text your Twilio WhatsApp
  number any question ("how many booked this week?") and the agent answers from
  live stats. This is "where you talk to the agent."

## Environment variables to set (Vercel → Settings → Environment Variables)

| Var | What | Where to get it |
|-----|------|-----------------|
| `OPENAI_API_KEY` | qualify + write + reply | already set |
| `OUTREACH_DEFAULT_TENANT` | your agency's tenant id (so Clay leads belong to you) | ask Claude to read it from your account |
| `OUTREACH_WEBHOOK_SECRET` | shared password for Clay / Instantly / Calendly webhooks | invent a long random string |
| `OUTREACH_CALENDLY_LINK` | the booking link the agent sends prospects | your Calendly event URL |
| `OUTREACH_OWNER_WHATSAPP` | your WhatsApp number in E.164 (+44…) | your phone |
| `INSTANTLY_API_KEY` | send the emails | Instantly → Settings → API |
| `INSTANTLY_CAMPAIGN_ID` | which campaign to drop leads in | Instantly campaign URL/settings |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | WhatsApp pings | already set (Twilio) |
| `CRON_SECRET` | protects the hourly cron | already set |

## Wiring the webhooks (one-time)

All webhooks authenticate with `Authorization: Bearer <OUTREACH_WEBHOOK_SECRET>`.

1. **Clay** → POST enriched leads to `/api/outreach/clay-ingest` with the Bearer
   header. Map fields: `company_name`, `website`, `first_name`, `email`, `city`.
2. **Instantly** → set the reply/auto-reply webhook to `/api/outreach/reply` with
   the Bearer header.
3. **Calendly** (your outreach event type) → webhook to `/api/outreach/booked`
   with the Bearer header.
4. **Twilio WhatsApp** → set the inbound message webhook to `/api/outreach/whatsapp`.

## Honest status

- **Built + type-checks; runtime-unverified.** No real Clay/Instantly/Calendly
  call has been exercised yet. Test with one real clinic before trusting it at volume.
- **Instantly reply-send** (`sendReply`) uses the v2 reply endpoint; the exact
  shape varies by Instantly plan. If a send fails, the agent hands you the drafted
  reply on WhatsApp to paste — nothing is lost — but verify the endpoint against
  your account and adjust if needed.
- **No rate-limiting yet** on the generate/push endpoints (needs Redis/Upstash).
- The dashboard "Outreach" tab still shows the manual console; the autopilot runs
  underneath it. A live stats view (`/api/outreach/stats`) exists for wiring in.
