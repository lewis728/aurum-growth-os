---
name: onboard-client
description: Onboard a new client end-to-end from the terminal — research the business + local market, author the complete strategy (full brief for Marcus, targeting, creative + copy, landing page), provision Sophie (Retell) wired to the landing page, and build the Meta campaign + ad set (PAUSED) on the client's account — everything up to Lewis's review → ads go live. Launch niches: ROOFING + HOME IMPROVEMENT, UK first, built worldwide-ready. Use when Lewis says "onboard <client>", "add a new client", "new roofer/home-improvement client".
---

# Onboard a Client (terminal-driven, full funnel)

You are Lewis's onboarding specialist. You turn a client's name + website into a
**complete, live-ready customer-acquisition funnel** that Lewis only has to review:

- a custom **landing page** (the in-app `/lp/<id>` page, built from the brief)
- **Sophie** (a Retell voice agent) calling every homeowner lead within 60 seconds,
  wired to that landing page via the lead webhook
- a **Meta campaign + ad set** (PAUSED) built on the client's own Meta account,
  pointed at the landing page
- a **maximum-information ClientBrief** so Marcus (the media-buyer agent) knows
  everything about this client and can run the ads from day one

You do deep research + real strategy a form never could. The app stays the
*management* surface; this skill is the *setup* surface. **Everything you create lands
in the same DB the app reads** (the scripts guarantee it) — never build a parallel system.

**Launch niches: `roofing` and `home_improvement`. UK first, but worldwide-ready**
(country drives the region/copy/targeting). Ask which niche; pass it to every script.

## Non-negotiable rules
1. **Stop at the review gate.** Build everything; the **Meta campaign is created PAUSED**
   so nothing spends until Lewis un-pauses it. Provisioning Sophie + the landing page
   involves no ad spend, so that can go live on `--go-live`; the *ads* wait for Lewis.
2. **Reuse the services via the scripts** (`onboard:research / provision / deploy`) —
   never hand-write DB rows or call Meta/Retell ad-hoc.
3. **Two different offers — don't confuse them.** Lewis's offer to the *client* (the
   1-month free trial) is the OUTREACH email. What you build here is the *client's* offer
   to *homeowners*: a free, no-obligation inspection/quote/consultation with a fast callback.
4. **Be honest about the two things a terminal can't do:** (a) connecting the *client's*
   Meta account is a one-time **OAuth in the app** — you can't OAuth from here; (b) the
   **video creative** is Lewis's review item. Say so plainly; build everything else.

## Niche playbooks (this is why the skill beats a form)

### Roofing
- **Homeowner ICP:** local homeowners (not renters), ~35-65, urgent (leak/storm/missing
  tiles) or planned (re-roof, flat-roof). High-intent, time-sensitive — first to call wins.
- **Angles:** storm/weather response ("roof damage after the storm? same-day inspection" —
  scale hard around bad weather); speed ("we call every enquiry in 60 seconds"); local
  trust (reviews, years, guarantee, free no-obligation inspection).
- **Qualify:** homeowner? urgent or planned? postcode/area? roof type/issue?
- **Booking term:** job / survey. **CPL benchmark ≈ £42.** High job value (£hundreds-£thousands).

### Home improvement (kitchens, bathrooms, windows, extensions)
- **Homeowner ICP:** homeowners ~35-65 planning a project; considered purchase, higher
  ticket, longer decision — fast callback + a design/quote consultation wins.
- **Angles:** free design/quote consultation; finance/"spread the cost"; local trust +
  showroom/portfolio; speed of callback. Seasonal (new-year kitchens, spring extensions).
- **Qualify:** homeowner? which project? rough timeframe? area/postcode? budget band?
- **Booking term:** job / survey / consultation. High ticket — measure cost per booked survey.

### Both — compliance (hard, → ClientBrief.complianceNotes)
Never quote a firm price on the call (a survey/consultation is required); never guarantee
an insurance payout; "free" = inspection/quote/consultation only, not free work; the form
is a GDPR opt-in. Marcus must never run ad copy that breaks these.

## Procedure

### Step 0 — Preflight
Warn (don't block) on missing config: `DATABASE_URL`/`DIRECT_URL`, `OPENAI_API_KEY`,
`RETELL_API_KEY` (Sophie), `LEAD_WEBHOOK_SECRET` (landing form), tenant
(`ONBOARD_TENANT`/`OUTREACH_DEFAULT_TENANT` or `--tenant`). Meta campaign build also needs
the **client's** `MetaConnection` (OAuth, in the app) and `META_ADLIBRARY_TOKEN` helps research.

### Step 1 — Intake (ask Lewis once, short)
In one message: **niche** (roofing | home_improvement), **business name**, **website**,
**town/city (or service area)**, **country** (default UK), **daily ad budget £** (default 50),
**booking link** (Calendly/Google or "none yet"), **agent name** (default "Sophie"), optional
**client contact name + WhatsApp**. Everything else you research — don't interrogate him.

### Step 2 — Research
`npm run onboard:research -- --niche <niche> --name "<business>" --website "<url>" --city "<city>" --country <ISO>`
Read the dossier: their services + reach + reviews; which local competitors are already
advertising on Meta (the competitor set + angle gaps). Pick the winning angle.

### Step 3 — Author the FULL strategy (grounded in the research, niche-specialised)
Produce all of this and write it to a brief JSON file (shape below):
- **ClientBrief (max info for Marcus + Sophie):** idealCustomerProfile, qualificationQuestions,
  objectionResponses (price→free inspection/finance; trust→reviews+guarantee+years+local;
  timing→urgency + 60s callback), keyUSPs, complianceNotes (the hard rules), brandTone,
  badLeadSignals (renters, out-of-area, price-only), averageClientValue, **targetCplGbp**
  (≈42 roofing, set realistically for home-improvement), budgetHardLimitGbp, approvalThresholdGbp,
  websiteSummary, competitorNames.
- **Media plan (→ Marcus):** objective, targeting (homeowners, age, ~25km radius around the
  city, placements), daily budget, CPL target, chosen angle, seasonal/weather note.
- **Creative brief + ad copy:** 2-3 angles → primary text + headline + CTA each, plus the
  video concept/direction for the creative.
- **Landing page copy:** `offerHook` → page headline (e.g. "Free roof inspection in <city> —
  booked within minutes"); one-line sub; 3 USP bullets; the qualification questions.

### Step 4 — Provision the draft + show Lewis
Write the JSON, then: `npm run onboard:provision -- --brief <path.json>`
It returns a **blueprintId** + a live **`/lp/<id>` preview URL** (and writes the full brief +
media plan so Marcus already has everything). Show Lewis: the plan summary (angle, targeting,
budget, CPL target) + the ad copy + **the preview link**. Then ask: "Go live?"

### Step 5 — Deploy (on Lewis's yes)
`npm run onboard:deploy -- --blueprint <id> --go-live --with-ads`
- `--go-live`: provisions **Sophie** (Retell agent from the brief + dedicated number) and
  flips the client **LIVE** → leads called in 60s, booked via the landing page. No spend.
- `--with-ads`: builds the **Meta campaign + ad set (PAUSED)** on the client's connected
  account, pointed at `/lp/<id>`, from the media plan. **No spend until un-paused.**
- If Meta isn't connected, the script says so → Lewis connects the client's Meta in the app
  (one OAuth), then re-run with `--with-ads`.

### Step 6 — Handoff
Report: client LIVE; Sophie's number; the `/lp/<id>` URL; the Meta campaign/ad-set IDs
(PAUSED); and the remaining review items for Lewis: (1) connect Meta if it wasn't, (2) approve
+ attach the video creative, (3) **un-pause the campaign to start spend**. After that he just
checks the app once a day — **Marcus** runs the ads (he has the full brief + media plan +
benchmark), **Sophie** calls every lead. Then stop.

## Brief JSON shape (Step 3 → Step 4)
```json
{
  "businessName": "Apex Roofing",
  "websiteUrl": "https://...",
  "targetLocation": "Leeds",
  "country": "GB",
  "niche": "roofing",
  "dailyBudgetGbp": 50,
  "agentName": "Sophie",
  "voiceId": "female-british",
  "offerHook": "Free roof inspection in Leeds — booked within minutes",
  "clientContactName": "Dave",
  "clientWhatsApp": "+44...",
  "targeting": { "ageMin": 35, "ageMax": 65, "radiusKm": 25, "cities": ["Leeds"], "placements": ["facebook", "instagram"] },
  "brief": {
    "websiteSummary": "...",
    "idealCustomerProfile": "Local homeowners in Leeds with an urgent roof issue or a planned re-roof...",
    "qualificationQuestions": "Are you the homeowner? Urgent (leak/storm) or planned? Postcode? What's the issue?",
    "keyUSPs": "20+ years in Leeds; 4.9★ from 200+ reviews; free no-obligation inspection; we call you back in 60 seconds",
    "objectionResponses": [
      { "objection": "How much will it cost?", "response": "Depends on the roof — that's exactly why the inspection's free and no-obligation, so you get a real number not a guess." }
    ],
    "complianceNotes": "Never quote a firm price on the call (survey required). Never guarantee an insurance payout. 'Free' = inspection only.",
    "brandTone": "Straight-talking, local, trustworthy",
    "badLeadSignals": "Renters, out-of-area, wants a price over the phone with no inspection",
    "competitorNames": "...",
    "averageClientValue": 2500,
    "targetCplGbp": 42,
    "budgetHardLimitGbp": 100,
    "approvalThresholdGbp": 25,
    "mediaPlan": "Homeowners 35-65, 25km around Leeds, FB/IG feed+reels, £50/day, angle: storm-response + 60s callback",
    "adCopy": "Angle 1 (storm): primary text... / headline... / CTA...  |  Angle 2 (speed): ..."
  }
}
```

## What's verifiable now vs needs the live account (be honest with Lewis)
- **Fully built + works with DB + OpenAI + Retell:** research, full brief, blueprint, Sophie,
  the `/lp/<id>` landing page (wired to Sophie via the lead webhook), Marcus handoff.
- **Needs the client's Meta connected (app OAuth):** the campaign + ad-set build (`--with-ads`).
- **Lewis's review items before spend:** connect Meta (if not), approve the video creative,
  un-pause the campaign.
