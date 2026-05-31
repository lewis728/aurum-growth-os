# Cowork ↔ Claude Code Channel

This file is the communication channel between Cowork and Claude Code.

## How it works
- Cowork writes instructions or answers here
- Claude Code reads this file at the start of every task
- Claude Code writes questions here when it needs a decision
- Claude Code never stops for anything else — only genuine blockers

## Current instruction

READ THIS FULLY BEFORE DOING ANYTHING ELSE. This is your complete operating brief.

---

## HOW YOU OPERATE FROM NOW ON

You are not a task executor. You are the lead engineer of a product being built to a 9-figure valuation. Every decision you make should reflect that standard.

**MINDSET:**
- Think like the best engineer at Stripe, Vercel, and Linear combined
- Every file you touch should be better when you leave it than when you found it
- Every feature you build should work perfectly with 1 client and with 10,000 clients
- Every external API call should handle failure gracefully — network drops, rate limits, timeouts, bad responses
- Never leave a TODO comment — either build it or note it in STATUS.md

**BEFORE EVERY SPRINT:**
1. Check Vercel runtime logs via MCP — fix any production errors before starting new work
2. Read every file you plan to touch — never write against assumed file contents
3. Ask: what is the agency owner's actual experience of this feature?
4. Ask: what happens when this fails at 3am with 100 clients running?

**DURING EVERY SPRINT:**
- If you see a better way to build something than specified — build it better and note why
- If you notice missing error handling — add it
- If you notice a security issue — fix it immediately
- If you notice a performance issue — fix it
- Never stop mid-sprint to ask for confirmation

**AFTER EVERY SPRINT:**
- tsc --noEmit must return zero errors before ANY commit — no exceptions
- Update docs/STATUS.md with what was built and what was tested
- Ask: what would an agency owner with 50 clients hate about what I just built? Fix it.
- Move immediately to the next sprint

**COMMUNICATION:**
- Never ask Lewis for confirmation on code decisions
- If you hit a genuine decision point (spending real money, destroying data) — write it to this file under "Questions from Claude Code" and wait
- Cowork monitors this file and will respond with a decision
- Everything else — just build it

---

## THE AGENT REASONING BRAIN — MUST BE 10X BETTER

The current media buyer is a 5-rule CPL threshold tree. That is not a media buyer. Rebuild it in Sprint 7 with this architecture:

**STEP 1 — OBSERVE:** Pull ALL breakdown data from Meta:
- Campaign level (exists)
- Ad set level (NEW: getAdSetInsights)
- Creative/ad level (NEW: getAdInsights)
- Audience breakdown by age, gender, placement (NEW: getAudienceInsights)

**STEP 2 — DIAGNOSE:** Feed all data to GPT-4o with structured causal reasoning:
System: "You are a media buyer with 30 years of Meta experience. Diagnose WHY performance is what it is. Be specific. Back every statement with data."

Return JSON: { diagnosis, action, actionType, expectedOutcome, watchFor, confidence }

**STEP 3 — DECIDE:** Apply safety guardrails AFTER GPT-4o:
- Never exceed ClientBrief.budgetHardLimit
- If change exceeds approvalThreshold → NEEDS_APPROVAL action
- If confidence < 0.7 → recommendation only, do not execute
- One action per cycle maximum

**STEP 4 — ACT:** Execute the specific diagnosed action

**STEP 5 — LOG:** Full audit trail including the GPT-4o diagnosis chain in plain English

---

## REMAINING SPRINTS — BUILD IN ORDER

### SPRINT 3C — Agent Team View (MISSED — BUILD BEFORE SPRINT 5)

Each client sub-account must show the dedicated team working for that client. It should feel like opening a Slack channel and seeing your team online.

**The team strip at the top of every client sub-account:**

5 profile cards in a row. Each one represents one specialist role:

Card 1 — THE CALLER (e.g. "Sophie")
- Gold avatar circle with initials
- Name in gold
- Role: "Lead Caller"
- Status dot: green if called a lead in last 4h, amber if last call was 4-24h ago, grey if inactive
- Last action: "Called James Wright — Booked · 2h ago"
- Click → opens chat with this agent

Card 2 — THE SCHEDULER ("James")  
- Blue avatar
- Role: "Appointment Scheduler"
- Status: green if appointment created in last 4h
- Last action: "Booked consultation for Sarah Chen · 3h ago"

Card 3 — THE MEDIA BUYER ("Marcus")
- Purple avatar
- Role: "Media Buyer"
- Status: green if reasoning cycle ran in last 4h
- Last action: "Scaled budget 20% — CPL tracking well · 4h ago"

Card 4 — THE REPORTER ("Ava")
- Pink avatar  
- Role: "Account Reporter"
- Status: green if briefing sent today
- Last action: "Morning briefing sent · 6h ago"

Card 5 — THE LEARNER ("Kai")
- Zinc avatar
- Role: "Intelligence"
- Status: green if distillation ran last night
- Last action: "Distilled 15 learnings · last night"

**How to determine agent names:**
- Caller: uses AIRepresentative.repName (already exists)
- Scheduler: auto-assigned "James" (or next name from a curated pool)
- Media Buyer: auto-assigned "Marcus"
- Reporter: auto-assigned "Ava"  
- Learner: always "Kai"

Store auto-assigned names on AIRepresentative as schedulerName, mediaBuyerName, reporterName. Default to the names above if not set.

**Below the team strip — a unified team activity feed:**

Shows the last 20 actions from ALL roles interleaved chronologically. Each entry shows:
- The agent's avatar (small, coloured circle with initial)
- Agent name in their colour
- What they did in plain English
- Time ago

Example:
🟡 Sophie: Called James Wright — Booked appointment for Thursday 2pm · 2h ago
🟣 Marcus: Scaled ad set budget from £40 to £48/day — CPL 28% below benchmark · 4h ago  
🔵 James: Sent booking confirmation SMS to James Wright · 2h ago
🩷 Ava: Sent morning briefing to Lewis · 6h ago
⬛ Kai: Distilled 15 learnings — updated brief · 8h ago

**This replaces the current "Recent activity" section in ClientSubAccount.tsx.**

The agency owner opens a client and immediately sees their whole team, what each person is doing, and a live feed of everything happening. It feels like a real team, not software.

Schema: add schedulerName String?, mediaBuyerName String?, reporterName String? to AIRepresentative. Migrate via Supabase MCP.

After building: tsc clean, commit, push, then build Sprint 3B (CRM pipeline), then continue to Sprint 5.

---

### SPRINT 3B — Per-Client CRM Pipeline (MISSED — BUILD BEFORE SPRINT 5)

This was missing from Sprint 3. Build it now before continuing.

In each client sub-account, replace the basic leads table with a proper pipeline board.

**Pipeline stages:** new → called → qualified → booked → showed → converted
**Sub-states:** no_answer, no_show, not_interested, retry_queue

**Each lead card shows:**
- Name, phone, lead score dot (green 7-10, amber 4-6, red 1-3)
- Time in current stage
- Last action Sophie took
- Next scheduled action

**Leads move automatically** based on AgentActions and appointment outcomes — no manual moving ever.

**Click a lead card → expand to show:**
- Full timeline of every AgentAction for this lead
- Call transcript (from callAnalysis if available)
- All SMS sent
- Appointment details
- Which ad/campaign drove this lead (source field)

**Schema additions** (via Supabase MCP only — never prisma migrate dev):
- Lead: pipelineStage String @default("new"), convertedAt DateTime?, dealValue Float?, source String?
- Lead: add @@index([tenantId, pipelineStage])

**Pipeline auto-movement logic:**
- Lead created → pipelineStage = "new"
- CALL_INITIATED AgentAction → pipelineStage = "called"
- CALL_FAILED (no answer) → pipelineStage = "no_answer"
- Appointment created → pipelineStage = "booked"
- Appointment scheduledAt passes, status = "confirmed" → pipelineStage = "showed"
- Appointment status = "no_show" → pipelineStage = "no_show"
- Agency owner marks converted → pipelineStage = "converted", dealValue set

**God Mode dashboard** should show total pipeline value across all clients (sum of booked × averageClientValue)

After building: tsc clean, commit, push, then continue to Sprint 5.

---

### SPRINT 4 — Slack Alerting
Create src/lib/services/alertService.ts
- notifySlack(webhookUrl, alert) — POST to agency's Slack webhook
- Fires on: CLIENT_AT_RISK, CPL > 3x benchmark, call failure rate > 50%, lead volume zero 6h business hours, NEEDS_APPROVAL created, Meta campaign delivery stopped
- Alert format: agent name, client name, issue in plain English, what Sophie tried, recommended action, link to sub-account
- Store SLACK_WEBHOOK_URL on AgencyProfile.slackWebhookUrl
- Settings UI: agency owner pastes their Slack webhook URL

### SPRINT 5 — ROI Reporting + Monthly Report Service
Create src/lib/cron/monthlyReportGenerator.ts
- Revenue: leads × booking rate × ClientBrief.averageClientValue
- ROI: revenue / ad spend
- GPT-4o writes narrative — not just numbers, a story
- Emails to ClientBrief.clientContactEmail under AgencyBranding (no Aurum branding)
- Stores in MonthlyReport table
- Cron: 0 9 1 * * (9am on 1st of month)

### SPRINT 6 — Kai Nightly Learner (THE MOAT)
Create src/lib/agents/roles/learner.ts
- Runs midnight every night for every LIVE blueprint
- Reads last 30 days: call transcripts, lead outcomes, AgentActions, objection patterns, show rates by slot, creative performance
- GPT-4o distils into max 15 sharp actionable facts about THIS specific client
- Examples: "Tuesday 10am-12pm calls 73% booking rate", "Objection 'need to think' converts 68% if followed up within 90min"
- Saves to ClientBrief.distilledLearnings
- All other roles read distilledLearnings at start of every cycle
- This is the compound learning effect — measurably smarter every night
- Cron: 0 0 * * *

### SPRINT 7 — Media Buyer Role Properly Separated + 10x Reasoning
Create src/lib/agents/roles/mediaBuyer.ts
- Migrate logic from clientAgent.ts
- Implement full 5-step diagnostic reasoning engine (see above)
- Ad set + creative + audience breakdown data from Meta
- GPT-4o causal diagnosis before any action
- Full reasoning chain in every AgentAction
- Reads Kai's distilledLearnings and VerticalProfile.expertBrief before reasoning
- One action per cycle maximum

### SPRINT 8 — Reporter Role Properly Separated
Create src/lib/agents/roles/reporter.ts
- Migrate morning briefing from morningBriefingService.ts
- Add weekly WhatsApp to ClientBrief.clientWhatsApp (Monday 9am)
- Add monthly report triggering
- Add at-risk detection with Slack alerting
- Add milestone messages (10 bookings, CPL improvement, campaign record)
- Reporter reads ALL other roles' AgentActions before writing

### SPRINT 9 — Client Communication Agent
Create src/lib/agents/roles/communicator.ts
- Handles ALL inbound messages from the agency's client
- Schema: ClientMessage model { id, blueprintId, tenantId, direction, channel, content, agentResponse, requiresApproval, approvedAt, createdAt }
- Determines intent: question, instruction, complaint, praise, request
- Questions → pulls real data, responds in under 2 minutes
- Instructions → checks approvalThreshold, acts or escalates
- Complaints → immediate Slack alert
- Messages UI in client sub-account with approve/send flow
- Pending approvals strip on God Mode dashboard

### SPRINT 10 — WhatsApp CRM
- Implement sendWhatsApp in twilioService.ts using Twilio WhatsApp API
- Weekly Monday 9am message under agency brand
- Event triggered: 10 bookings milestone, CPL improvement, campaign concern
- Cron: 0 9 * * 1

### SPRINT 11 — Volume Pricing in Stripe
- 1-5 clients: £500/mo, 6-10: £400/mo, 11-20: £350/mo, 21+: £300/mo
- Platform fee £97/mo always
- computeMonthlyTotal() calculates based on seat count
- Billing page shows current tier, next tier, savings until next tier
- "You're 2 clients away from dropping to £400/client — saving £200/month"

### SPRINT 12 — White Label Fully Applied
- Agency branding applied everywhere: reports, SMS, landing pages, dashboard CSS
- Settings page: upload logo, brand colour, custom domain, email sender name
- All monthly reports: agency logo, agency colours, zero Aurum mention
- Landing pages: agency logo, no Aurum branding
- Dashboard: CSS variables update from AgencyBranding.primaryColour

### SPRINT 13 — Vertical Training System
Create src/lib/agents/verticalTrainer.ts
- Weekly Sunday midnight cron for each vertical
- Meta Ad Library API scrape for this vertical in GB
- GPT-4o analyses: what formats winning, what saturated, what emerging
- Compliance update: latest ASA/CAP rules for this vertical
- Distil into VerticalProfile.expertBrief — max 2000 words, written as 30-year expert
- All client agents in this vertical read this brief before every decision
- Cron: 0 0 * * 0

### SPRINT 14 — Per-Client Twilio Number
- On Deploy Sophie: search Twilio for available UK mobile number, purchase automatically
- Register with Retell via POST /create-phone-number-transactional
- Store on AIRepresentative.twilioPhoneNumber
- All calls for this client use this number — consistent caller ID
- Idempotent — never purchase twice for same blueprint
- Graceful fallback to shared number if purchase fails

### SPRINT 15 — Competitor Intelligence
Create src/lib/services/competitorIntelService.ts
- Weekly scan: Meta Ad Library for competitors in client's geography + vertical
- Extract: creative formats, headlines, CTAs, offers
- GPT-4o: what's working for competitors, what gaps exist
- Store in ClientBrief (append weekly, keep last 4 weeks)
- Friday morning briefing includes competitor update
- Client sub-account shows competitor ads panel

### SPRINT 16 — Marketing Website
- Separate Next.js app in /marketing folder
- Dark premium design matching dashboard
- Hero: "Your agency. Fully staffed by AI."
- Show the 5-role team with avatars
- Pricing: £97/month + £200 starter + £500 full service + volume discount table
- Waitlist form: name, email, agency name, how many clients
- WaitlistEntry model + /api/waitlist route
- Framer Motion animations
- Deploy to separate Vercel project

### SPRINT 17 — Prospect Research Tool
- New section: "Win new clients"
- Agency owner inputs prospect URL + company name
- Sophie scrapes website, checks Meta ads, analyses competitors
- GPT-4o generates tailored 90-day proposal
- Export as branded PDF
- Agency owner walks into pitch with a document that looks like a £5,000 strategy session

---

## THE STANDARD

When done with all 17 sprints, an agency owner should be able to:
1. Sign up, add a client, fill brief, click Deploy Sophie
2. Within 2 minutes: dedicated Retell agent live, landing page deployed, calendar connected
3. Every lead called within 60 seconds automatically, 24/7
4. Every appointment booked directly into client's calendar
5. Every campaign optimised every 4 hours with diagnostic reasoning
6. Every morning: first-person briefing from their agent
7. Every week: WhatsApp update to their client under agency brand
8. Every month: professional ROI report to their client
9. Agent getting smarter every night via Kai
10. Agency owner's only job: signing new clients

Build to that standard. Nothing less.

---

## Questions from Claude Code
[NONE]
