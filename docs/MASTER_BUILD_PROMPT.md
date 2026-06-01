# Master Build Prompt — Read This Fully Before Doing Anything

This file contains the complete build instructions for today's session. Read every word before writing a single line of code.

---

## WHAT ALREADY EXISTS — READ THESE FILES FIRST

Before building anything, check if it exists. These are all confirmed built:

**AGENT ROLES (src/lib/agents/roles/):**
caller.ts, scheduler.ts, mediaBuyer.ts, reporter.ts, learner.ts, communicator.ts

**TRAINING SYSTEM (src/lib/training/) — CHECK IF THIS EXISTS FIRST:**
adversarialEngine.ts — 8 hostile personas + 6 campaign scenarios (Gemini-authored)
callerTrainer.ts — may exist
mediaBuyerTrainer.ts — may exist
shadowMode.ts — may exist
certaintyIndex.ts — may exist
trainingRunner.ts — may exist

If any training files exist: read them fully before touching. Extend, never duplicate.

**SERVICES (src/lib/services/):**
alertService.ts — Slack alerting, already wired
vectorKnowledgeService.ts — pgvector on Supabase, already enabled
posIntegrationService.ts — LTV feedback loop shell
leadEnrichmentService.ts — lead fingerprinting shell
creativeSimulator.ts — 15-persona creative gate
competitorIntelService.ts — weekly Ad Library scan
prospectResearchService.ts — 90-day proposal generator
smsTemplates.ts — vertical SMS defaults (6 verticals seeded)
agentProvisioning.ts — Deploy Sophie, creates Retell agent + script

**GEMINI ADDITIONS (confirmed in codebase or COWORK_CHANNEL.md):**
- Certainty Index formula with division-by-zero fix (max(volatilityIndex, 0.01))
- Shadow Mode 14-day deployment framework
- Adversarial grader: "brutally honest, NOT lenient, penalises every lost booking"
- Script refinement: REWRITE not append, max 800 tokens
- Stochastic noise ±30% on Meta campaign numbers
- Transcription noise 15% injection on caller simulations

**INFRASTRUCTURE:**
- pgvector enabled on Supabase (version 0.8.0)
- 11 crons in vercel.json (reminders, agent-reasoning, morning-briefing, nightly-learning, client-whatsapp, vector-knowledge, vertical-training, competitor-intel, monthly-report, spend-fee, performance-aggregation)
- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set (realtime active)
- RESEND_API_KEY set (reports active)
- SLACK_WEBHOOK_URL set (alerts active)

READ ALL OF THESE FILES BEFORE WRITING ANYTHING. The rule: if it exists, extend it. Never duplicate. Never assume what's in a file — read it first.

---

## PART 1 — COMPLETE SYSTEM AUDIT

Before building anything, audit the entire codebase against the 12 end goals:

1. Deploy Sophie → dedicated Retell agent with bespoke script in 2 minutes
2. Lead submits → 60-second call, 24/7
3. Sophie qualifies, handles objections, books into Google Calendar or Calendly
4. SMS sequences: confirmation, day-before, hour-before, no-show, qualified nudge
5. Marcus checks Meta every 4 hours — pauses, scales, never touches learning phase
6. Ava sends 6am briefing — GPT-4o, first person, specific
7. Kai distils at midnight — 15 facts updated nightly
8. Monthly report to client email under agency branding with ROI
9. Weekly WhatsApp to client under agency brand
10. God Mode dashboard — all clients, leads, booked, flags
11. Slack alerts fire on any edge case
12. Agency owner edits SMS templates and call scripts in app — live immediately

For each: built/wired/tested status, what's broken, specific fix needed.

Read these files specifically:
- src/lib/services/agentProvisioning.ts
- src/lib/services/speedToLeadService.ts
- src/app/api/webhooks/leads/[blueprintId]/route.ts
- src/lib/services/calendarService.ts
- src/lib/services/twilioService.ts
- src/lib/services/smsTemplates.ts
- src/lib/agents/roles/reporter.ts
- src/lib/agents/roles/learner.ts
- src/lib/agents/roles/mediaBuyer.ts
- src/lib/services/alertService.ts
- src/components/dashboard/CommsTemplatesPanel.tsx
- vercel.json

Output: traffic light per area (green/amber/red), top 5 fixes before first client, honest verdict: ready to sign a real client today?

---

## PART 2 — FIX EVERYTHING RED AND AMBER

After the audit, immediately fix every red and amber item. Read the actual files first. tsc=0 before every commit. One commit per fix. Never commit broken code.

---

## PART 3 — SIX VERTICAL INTELLIGENCE SYSTEM

The 6 verticals:
1. Aesthetics clinics
2. Cosmetic dentistry
3. Roofing
4. Solar installation
5. HVAC
6. Home improvement

**RESEARCH PHASE — do this before writing any code:**

For each vertical, use web search to find real current data:
- Real industry CPL benchmarks (search "[vertical] Facebook ads CPL benchmark 2024 2025")
- Top objections real businesses face (search "[vertical] business owner objections marketing agency")
- Seasonal patterns (search "best time to run [vertical] Facebook ads UK US")
- Compliance rules (search "[vertical] advertising compliance UK ASA" and "US FTC [vertical] advertising rules")
- What creative formats actually convert (search "[vertical] Facebook ad creative best performing 2024")
- Audience targeting that works (search "[vertical] Facebook audience targeting")

Do NOT use training data for benchmarks. Scrape the actual current web.

**BUILD PHASE — Create scripts/seed-verticals.ts:**

For each vertical, generate and upsert into VerticalProfile:

expertBrief (min 2000 words) — written as a 30-year veteran of running ads in this vertical. Must include:
- Real CPL ranges from research
- Exact audience targeting parameters
- Creative formats ranked by performance with reasoning
- Seasonal calendar with specific trigger events
- Psychology of the buyer in this vertical
- What kills campaigns in this vertical
- Compliance landmines specific to this vertical
- Call timing data — best days, times, and why
- Lead quality signals — hot lead vs waste of time
- Top objections and the frameworks that overcome them

objectionPlaybook (Json) — top 10 objections per vertical:
- The objection verbatim (how the lead actually says it)
- The underlying fear behind the objection
- The response framework (psychological approach, not a script)
- The closing line that moves them forward

callTimingData (Json) — per vertical:
- Best days of week, best times, worst times, why

complianceNotes — every claim Sophie must never make, phrases that get ads banned, regulatory bodies governing this vertical

seasonalPatterns (Json) — month by month with specific external triggers

Vector knowledge — 20 winning psychological frameworks per vertical as embeddings in VectorKnowledge table (underlying mechanisms, not specific copy)

Add to package.json: "seed:verticals": "tsx scripts/seed-verticals.ts"
After building: run npm run seed:verticals to populate all 6 verticals.

---

## PART 4 — ADVERSARIAL AGENT TRAINING SYSTEM

Check src/lib/training/ first — files may already exist from previous sessions. Read them before touching.

Build (or extend if exists) the full adversarial training system:

**adversarialEngine.ts** — 8 hostile lead personas with hidden execution rules:
- The Interrupter: cuts off every 4 seconds
- The Multi-Objector: throws 3 simultaneous objections
- The Sudden Death: 8% hang-up chance mid-call
- The Confused: bad audio, asks to repeat everything
- The Hostile: furious at being called
- The Tire-Kicker: chatty, will never book
- The Premium: rejects any discount language immediately
- The Price-Anchored: only cares about exact cost

6 campaign scenarios for Marcus:
- Learning Hell: CPL +400% in 12h — correct: DO NOTHING
- Data Poisoning: Meta=0 conversions, internal=12 — correct: FLAG TRACKING BROKEN
- Frequency Cliff: frequency 3.1 overnight — correct: SWAP CREATIVE
- Competitor Surge: CPM doubles, no internal changes — correct: WAIT
- Budget Trap: scaling 50% shifts auction pool — apply ±30% stochastic noise
- Learning Limited: small audience, stuck — correct: CONSOLIDATE OR BROADEN

**callerTrainer.ts** — per-vertical call simulation:
- Vertical-specific lead personas (aesthetics lead ≠ roofing lead)
- 12-turn max conversation
- 15% transcription noise injection
- ADVERSARIAL grader prompt: "You are a brutally honest sales manager with 20 years running call centres. You are NOT lenient. Find every moment Sophie would lose a real booking. Penalise heavily for: vague language, not getting a specific date/time, letting the lead control the conversation, any desperation, any compliance violation. 80+ means this works on a real human actively avoiding booking."
- Self-healing: 3 cycles, REWRITE not append, max 800 tokens
- Saves refined script to VerticalProfile per vertical

**mediaBuyerTrainer.ts** — per-vertical Meta scenario training:
- ±30% stochastic noise on all numbers
- Grades against correct decisions
- Partial pass for close-but-wrong reason codes

**shadowMode.ts** — 14-day shadow deployment:
- Agent receives real data, execution layer blocked
- Logs to ShadowAction table
- Auto-promotes at 85% accuracy over 14 days

**certaintyIndex.ts** — Marcus confidence gate:
- Formula: consecutiveSteadyDays / (max(volatilityIndex, 0.01) × learningPhaseRisk)
- learningPhaseRisk: LEARNING=1.8, LEARNING_LIMITED=2.2, ACTIVE=1.0
- Below 0.85: intercept, Slack alert, needs approval

**trainingRunner.ts** — main orchestrator:
- All 6 verticals
- Full: 100 caller + 30 media buyer scenarios per vertical = 780 total
- Concurrency limit: 3
- --dry-run flag: cost estimate without API calls
- --quick flag: 5 scenarios per vertical
- Final scorecard: per agent, per vertical, per scenario type

Schema additions (via Supabase MCP only):
```
model TrainingResult {
  id           String   @id @default(cuid())
  agentRole    String
  vertical     String
  scenarioType String
  overallScore Int
  breakdown    Json
  weaknesses   Json
  improvements Json
  passed       Boolean
  createdAt    DateTime @default(now())
  @@index([agentRole, vertical])
}

model ShadowAction {
  id                String   @id @default(cuid())
  blueprintId       String
  agentRole         String
  intendedAction    String
  intendedReasoning String
  actualOutcome     String?
  wasCorrect        Boolean?
  createdAt         DateTime @default(now())
  @@index([blueprintId, agentRole])
}
```

Add to package.json:
- "train": "tsx src/lib/training/trainingRunner.ts"
- "train:quick": "tsx src/lib/training/trainingRunner.ts --quick"
- "train:estimate": "tsx src/lib/training/trainingRunner.ts --dry-run"

After building: run npm run train:estimate to show cost before running full training.

---

## PART 5 — GLOBAL OUTREACH MACHINE

Infrastructure: 12 domains, 60 inboxes, 2,400 emails/day. Global: US, UK, Canada, Australia, UAE. Time-zone segmented 8:30am-5pm local.

The offer: 4-week free pilot. Manage ads, call every lead within 60 seconds, all follow-up, booked appointments to calendar. Zero setup fee. Zero retainer. Zero contract. No results = pay nothing, keep everything.

**Spintax rules — NEVER send American copy to UK/AU or vice versa:**
- US market: leads, appointments, zip codes, profits, cell phone, schedule a call
- UK/AU/NZ: bookings, jobs, enquiries, postcodes, revenue, mobile, diary, have a chat
- UAE/International: formal, no slang, results-focused

**Create src/lib/outreach/emailSequences.ts:**

EMAIL 1 — Day 0 — The Hook + Offer:
Subjects: {free for 28 days|we take all the risk|no upfront cost|4 weeks on us} — [business_name]

Vertical opening lines (US and UK variants for each):

AESTHETICS:
US: "Hey {first_name}, I know how it feels when a lead fills out your form at 7pm and nobody can call them back until tomorrow morning. By then they've booked somewhere else."
UK: "Hey {first_name}, I know how frustrating it is when an enquiry comes in at 7pm while you're with a client, and by the time anyone rings back the next morning they've already gone elsewhere."

ROOFING:
US: "Hey {first_name}, when someone sees your ad right after a storm and fills out your form, they're calling 3 other roofers at the same time. Whoever calls first gets the job."
UK: "Hey {first_name}, when a homeowner spots a problem after bad weather and fills in your form, they're ringing round. Whoever gets back to them first gets the job."

SOLAR:
US: "Hey {first_name}, most solar leads go cold within 4 hours. Not because people change their mind — because nobody called them while they were still excited about their energy bill."
UK/AU: "Hey {first_name}, most solar enquiries go cold within a few hours. Not because people lose interest — because nobody rang them while they were still thinking about their energy bills."

HVAC:
US: "Hey {first_name}, when someone's AC breaks in August they call whoever picks up first. Not the best HVAC company in town — the fastest."
UK: "Hey {first_name}, when someone's boiler packs in on a cold morning they ring whoever answers first. Not the best engineer in the area — the quickest to pick up."

DENTISTRY:
US: "Hey {first_name}, dental practices lose 60% of their website leads because the callback comes the next business day. By then the patient has booked with whoever called them the same evening."
UK: "Hey {first_name}, most dental practices lose over half their online enquiries because nobody rings back until the next working day. By then the patient has already sorted it elsewhere."

HOME IMPROVEMENT:
US: "Hey {first_name}, kitchen and bathroom leads have a 4-hour window. After that they've either booked someone else or talked themselves out of spending the money."
UK: "Hey {first_name}, home improvement enquiries go cold fast. Most people fill in a form on Saturday morning — if nobody's rung them by Saturday afternoon, they've moved on."

Core offer body (US version):
"For the next 4 weeks, we want to fully manage your ads, call every single lead within 60 seconds, handle all the follow-up, send text reminders, and deliver booked {appointments|jobs|consultations} straight to your calendar. Completely free. No setup fees. No retainer. No contract. If we don't bring you real paying {customers|clients|patients} in 28 days, you owe nothing and keep everything we build. We're taking 100% of the risk. We can only do this for 2 {vertical} businesses right now. Worth a quick 5-minute call to see the math?"

Core offer body (UK version):
"For the next 4 weeks, we want to fully manage your ads, ring every single enquiry within 60 seconds, handle all the follow-up, send text reminders, and deliver confirmed {bookings|jobs|consultations} straight to your diary. Completely free. No setup fees. No retainer. No contract. If we don't bring you real paying {customers|clients|patients} in 28 days, you owe us nothing and keep everything we build. We're taking all the risk. We can only do this for 2 {vertical} businesses at the moment. Worth a quick 5-minute chat to see how it works?"

EMAIL 2 — Day 4 — The Problem:
Subject: "what happens at 9pm on a {Sunday|Saturday}?"
4 paragraphs max. The lead response time problem. Vertical and region specific.

EMAIL 3 — Day 8 — The Proof:
Subject: "{43|45|60} seconds"
"This is what it looks like when someone fills in {a form|an enquiry} at 11pm and gets called {43|45} seconds later: [CALL RECORDING LINK]. No human involved. Fully automatic. That's what we're setting up for you, free for 28 days."

EMAIL 4 — Day 11 — Pattern Interrupt:
Subject: "my {system|software} {glitched|cut out} — {morning or afternoon|AM or PM}?"
3 sentences max. Casual. Feels like a genuine system error.

EMAIL 5 — Day 14 — Breakup:
Subject: "{closing your file|last one from me|won't bother you again}"
2 sentences. Warm, no pressure, door open.

**hookGenerator.ts** — personalised opening line per prospect:
- Scrapes website (reuse existing scrape logic from /api/clients/scrape-website)
- Checks Meta Ad Library for their ads
- GPT-4o generates ONE specific sentence referencing something real
- Must NOT contain: "I came across", "I noticed", "I stumbled upon"
- Must sound like a human who spent 2 minutes looking at their business
- Detects country from location field → applies correct regional language

**sequenceBuilder.ts** — takes prospect, returns Instantly-ready sequence:
- Detects region from country field → applies US or UK spintax variant
- Substitutes all variables
- Returns { emailNumber, subject, body, sendDay }[]

**Schema additions (via Supabase MCP only):**
```
model OutreachProspect {
  id            String   @id @default(cuid())
  firstName     String?
  companyName   String
  website       String
  vertical      String
  location      String?
  country       String   @default("GB")
  contactEmail  String?
  status        String   @default("pending")
  customHook    String?
  emailsSent    Int      @default(0)
  lastEmailAt   DateTime?
  repliedAt     DateTime?
  bookedAt      DateTime?
  notes         String?
  createdAt     DateTime @default(now())
  sequences     OutreachSequence[]
  @@index([status, vertical, country])
}

model OutreachSequence {
  id          String   @id @default(cuid())
  prospectId  String
  emailNumber Int
  subject     String
  body        String
  prospect    OutreachProspect @relation(fields: [prospectId], references: [id])
}
```

Routes:
- POST /api/outreach/generate — prospect details → 5-email sequence with regional spintax
- POST /api/outreach/import — Apollo CSV bulk import with country detection
- GET /api/outreach/prospects — pipeline view with vertical and country filters
- PATCH /api/outreach/prospects/[id] — status, notes, booked date

Dashboard — Outreach tab in sidebar:
- Pipeline: Prospects | Emailing | Replied | Demo Booked | Closed | Won
- Filters: by vertical, by country, by status
- Add prospect form → generates sequence immediately
- Import CSV button → bulk Apollo import
- Per prospect: 5 emails with copy buttons, status dropdown, notes
- Stats strip: emails sent today, reply rate, demos booked this week

---

## PART 6 — SCALABILITY HARDENING

Audit and fix for 5,000 concurrent clients:

1. Every cron uses Promise.allSettled — verify everywhere, fix if missing
2. Every DB query has tenantId index — check every model, add missing indexes
3. Every external API call has timeout + retry — Retell, Twilio, Meta, OpenAI
4. Agent reasoning cron at 1000 clients — add cursor-based batching if Vercel maxDuration insufficient
5. Nightly learning cron — same batching check
6. Prisma connection pool — configured for high concurrency?
7. Circuit breakers — Meta 429 = exponential backoff, not fail
8. Idempotency keys — all Stripe and Twilio number purchase operations

---

---

## PART 7 — CONVERSATIONAL LINGUISTICS MATRIX (Layer 6)

Marcus reads actual SMS and call transcripts to build city-level conversational models. Sophie doesn't use a generic script — she uses the linguistic model proven to convert in that specific city.

**Create src/lib/intelligence/conversationalMatrix.ts**

After every call outcome and SMS reply, extract:
- The exact objection language used (verbatim)
- The city and vertical
- Which response framework was used
- Whether it converted (booked/not booked)

Store in a new ConversationalPattern table:
```
model ConversationalPattern {
  id              String   @id @default(cuid())
  vertical        String
  city            String
  country         String
  objectionType   String   -- price/time/trust/competitor/logistics
  objectionVerbatim String -- what the lead actually said
  responseUsed    String
  converted       Boolean
  confidenceScore Float
  sampleSize      Int      @default(1)
  createdAt       DateTime @default(now())
  @@index([vertical, city, objectionType])
}
```

**A/B Testing Objection Responses:**
When a new objection pattern is detected in a city with < 10 samples:
- Generate 5 response variants using GPT-4o
- Rotate through them across the next 20 conversations
- Track conversion rate per variant
- After 20 samples: promote winner to ConversationalPattern as the confirmed response
- Log: "Tested 5 downtime objection responses in Manhattan aesthetics. Winner: cold-compress protocol mention. 34% uplift in booking rate."

**City Linguistic Persona System:**
After 30+ samples in a city, generate a CityPersona stored in VerticalProfile.geoIntelligence:
```
"cityPersonas": {
  "manhattan": {
    "primaryObjection": "logistics/time",
    "buyingStyle": "high-urgency, time-sensitive",
    "languageStyle": "direct, no fluff, respect their time",
    "mustAvoid": "long explanations, soft closes",
    "winningFrameworks": ["speed + convenience", "credentials + trust"],
    "exampleWinningResponse": "Yes, we use a cold-compress protocol that clears redness in 15 mins — most clients go straight back to the office"
  },
  "toronto": {
    "primaryObjection": "trust + emergency financing",
    "buyingStyle": "value-conscious, risk-averse",
    "languageStyle": "warm, honest, no pressure",
    "mustAvoid": "pushy closes, hidden costs",
    "winningFrameworks": ["waived diagnostic fee if booked on spot", "transparent pricing upfront"]
  }
}
```

When a new client onboards in Manhattan aesthetics — Sophie immediately pulls the Manhattan aesthetics CityPersona and uses the proven linguistic model. She doesn't start from scratch.

**Wire into caller.ts and scheduler.ts:**
- Before every call: inject CityPersona into Sophie's Retell dynamic variables
- After every SMS reply: extract objection, log to ConversationalPattern, update A/B test data
- After every call transcript: extract objection language, update patterns

---

## PART 8 — OPERATIONAL CAPACITY AUTOTHROTTLE (Layer 7)

Marcus monitors the client's actual calendar capacity and throttles ad spend to match. Prevents over-delivery which is the #1 reason agencies lose clients.

**Create src/lib/intelligence/capacityMonitor.ts**

For each LIVE blueprint:
1. Check CalendarConnection — if Google Calendar connected, fetch available slots for next 14 days
2. Calculate capacity utilisation: booked slots / total available slots
3. Determine throttle action:
   - > 90% utilised → scale Meta budget DOWN 40%, log "Throttling spend — client at 90% capacity"
   - > 75% utilised → scale DOWN 20%, log "Reducing spend — client at 75% capacity"  
   - < 40% utilised → scale UP 20% (if below budgetHardLimit), log "Scaling spend — client has available capacity"
   - 40-75% → maintain current budget, no action

**Flash Campaign System:**
Monitor for calendar cancellations:
- Check calendar every 2 hours during business hours (cron: */2 8-18 * * 1-5)
- If 2+ slots cancelled within last 2 hours → FLASH CAMPAIGN:
  1. Query Lead table for this blueprintId where status = "qualified" AND appointmentBooked = false (warm leads who didn't convert)
  2. Send immediate SMS: "Hi [name], we've just had a cancellation at [time] on [day] at [businessName]. Would you like to grab that slot? It's going fast." (use ClientBrief.smsTemplates if available)
  3. Log AgentAction: "Flash campaign launched — 3 cancellations detected, 8 warm leads contacted"
  4. Track which warm leads book within 2 hours

**Retainer Transition Report (Day 25):**
On day 25 of a client's trial (detect from blueprint.createdAt):
- Generate performance summary:
  - Total leads generated
  - Total appointments booked
  - Estimated revenue (appointments × ClientBrief.averageClientValue)
  - Capacity utilisation rate
  - ROI of retainer vs trial cost
- Store as a ReportCard in DB
- Send to agency owner via Slack: "Day 25 report ready for [businessName]. Estimated £[X] revenue generated. 16x ROI on the £2,000 retainer. Recommend transition."
- Shows in God Mode dashboard under "Retainer Opportunities"

Schema:
```
model CapacitySnapshot {
  id              String   @id @default(cuid())
  blueprintId     String
  tenantId        String
  utilisationPct  Float
  availableSlots  Int
  bookedSlots     Int
  action          String?  -- what Marcus did
  createdAt       DateTime @default(now())
  @@index([blueprintId])
}
```

Add capacity-monitor to vercel.json: { "path": "/api/cron/capacity-monitor", "schedule": "0 */2 * * *" }

---

## PART 9 — GLOBAL AD AUCTION ARBITRAGE (Layer 8)

Marcus watches CPM fluctuations globally and shifts portfolio focus to where margins are highest.

**Create src/lib/intelligence/auctionArbitrage.ts**

Every 6 hours, for each LIVE blueprint, fetch current CPM from Meta Insights.
Store in a rolling 14-day CPM history per blueprint.

Calculate CPM index: current CPM / 14-day average CPM
- CPM index > 1.5 (50% spike): market is expensive — flag as HIGH COST
- CPM index < 0.7 (30% below average): market is cheap — flag as LOW COST OPPORTUNITY

**Portfolio Rebalancing Logic:**
Across ALL clients in the same vertical:
- Identify HIGH COST markets (CPM spiking)
- Identify LOW COST markets (CPM depressed)
- Generate a portfolio recommendation for the agency owner:

"MARKET ALERT: Manhattan aesthetics CPMs up 52% — US election ad competition. Dubai aesthetics CPMs down 31% — low competition window.
Recommendation: Reduce Manhattan outreach budget 30% for next 2 weeks. Scale Dubai outreach immediately. Shift 2 of your 12 sending domains to UAE prospects."

Send to agency owner via Slack + show in God Mode dashboard under "Market Intelligence".

**Outreach Domain Reallocation:**
Store in AgencyProfile: outreachAllocation Json
When arbitrage opportunity detected:
- Update the allocation recommendation: { "manhattan": 0.1, "dubai": 0.4, "toronto": 0.3, "london": 0.2 }
- Show in Outreach tab: "Marcus recommends shifting 4 domains to Dubai prospects this week — CPMs 31% below average"
- Agency owner approves with one click

**CPM Spike Protection:**
When a client's CPM spikes > 50% vs 14-day average:
- If spike is > 3 days: automatically reduce budget 20% to protect ROI
- Log: "CPM spike detected — reducing daily budget from £50 to £40 to maintain target CPL"
- Notify agency owner via Slack

Schema:
```
model CpmSnapshot {
  id          String   @id @default(cuid())
  blueprintId String
  tenantId    String
  cpm         Float
  cpmIndex    Float    -- vs 14-day average
  country     String
  vertical    String
  createdAt   DateTime @default(now())
  @@index([blueprintId, createdAt])
  @@index([vertical, country, createdAt])
}
```

Add to vercel.json: { "path": "/api/cron/auction-arbitrage", "schedule": "0 */6 * * *" }

---

## EXECUTION ORDER

1. Read ALL existing files listed above before touching anything
2. Audit (Part 1) — report findings
3. Fix all red/amber (Part 2) — tsc=0, one commit per fix
4. Research verticals on the web, then seed (Part 3) — run npm run seed:verticals
5. Build/extend training system (Part 4) — run npm run train:estimate
6. Build outreach system (Part 5)
7. Scale hardening (Part 6)

After each part: tsc --noEmit. Fix all errors. Never commit broken code.
Migrate all schema via Supabase MCP only. Never prisma migrate dev.

When complete, report:
- Audit traffic lights
- What was fixed
- Training cost estimate
- Vertical seeding confirmation
- Any blockers

This is a $100M ARR product. Build it like one.
