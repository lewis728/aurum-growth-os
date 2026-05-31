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
- READ THE TARGET FILE FIRST — always. Never write code against an assumed file state.
- Before adding any function, import, or variable — grep the codebase to confirm it doesn't already exist
- Before adding any schema field — query Supabase MCP to confirm the column doesn't already exist in production
- Before adding any cron — check vercel.json to confirm it's not already registered
- If something already exists — extend it, don't duplicate it
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

### SPRINT 10B — Pro Media Buyer Intelligence (BUILD BEFORE SPRINT 11)

The current media buyer checks CPL and CTR. A real pro media buyer thinks about much more. Add this intelligence to mediaBuyer.ts and the Meta Insights calls.

**1. Learning phase detection**
When Meta returns a campaign/ad set, check the `effective_status` field:
- If status is "LEARNING" — do NOT make any changes. Log AgentAction: "Ad set in learning phase — no changes made. Waiting for 50 conversion events before optimising."
- If status is "LEARNING_LIMITED" — flag to agency owner: "Ad set stuck in learning — audience may be too narrow or budget too low"
- Only act on ACTIVE ad sets that have exited learning

Add to getAdSetInsights: request `effective_status`, `learning_stage_info` fields from Meta API

**2. Frequency monitoring**
Add `frequency` to the Meta Insights fields requested. 
- Frequency > 2.0 AND CTR declining → creative fatigue confirmed (not just CTR drop)
- Frequency > 3.0 → pause creative immediately, flag for replacement
- Log: "Pausing [ad name] — frequency hit 3.1, audience has seen this ad too many times"

**3. Budget pacing check**
Request `spend` broken down by hourly delivery (Meta supports this with time_increment=1).
- If 70%+ of daily budget spent by midday → audience too narrow or bid too aggressive
- Flag: "Budget front-loading detected — consider broadening audience or reducing bid cap"

**4. Campaign structure reasoning**
In the GPT-4o diagnostic prompt, add these rules to the system prompt:
- "Never recommend changes to ad sets in LEARNING status — explain why"
- "Flag if more than 5 ad sets are running simultaneously — audience overlap risk"  
- "Recommend consolidating underperforming ad sets rather than just pausing them"
- "Consider 3-day and 7-day attribution windows, not just today's data"

**5. Attribution window context**
When pulling insights, always pull both:
- `action_attribution_windows: ["1d_click", "7d_click"]`
- Compare 1-day vs 7-day — if 7-day is much higher, leads are taking longer to convert (consideration product)
- This affects how aggressive to be with scaling

**6. The pro reasoning context injected into GPT-4o:**

Add this to the mediaBuyer system prompt:
"You are a Meta ads expert with 30 years experience. You know:
- Never touch a campaign in LEARNING phase (needs 50 conversions to exit)
- Frequency above 2.5 means creative fatigue, above 3.0 means pause immediately  
- Budget front-loading (70%+ spent by midday) means audience is too narrow
- 7-day attribution is more reliable than 1-day for high-ticket services
- Audience overlap between ad sets wastes budget — consolidate not multiply
- CPM rising week-on-week with same audience = audience saturation
- Strong hook rate (3s video views/impressions > 25%) but low CTR = body copy problem
- Low hook rate = creative opening isn't stopping the scroll
- Always check if underperformance is campaign issue vs external (seasonality, competitor surge)"

After building: tsc clean, commit, push, then continue to Sprint 11.

---

### SPRINT 3D — Editable SMS Templates + Call Scripts In-App (BUILD NEXT)

Agency owners must be able to edit all communication templates directly in the dashboard and save them. Changes go live immediately for all future leads. No code changes ever needed.

**What's editable:**

1. SMS Templates (per client):
   - Post-call booked confirmation
   - Post-call qualified follow-up
   - Day-before reminder
   - Hour-before reminder  
   - No-show follow-up
   - 7-day re-engagement sequence (3 messages)
   - Phantom callback at 23 minutes

2. Call Script (per client):
   - Sophie's opening line
   - Qualification questions (add/remove/reorder)
   - Objection responses (add/remove/edit)
   - Closing/booking language
   - Voicemail script

3. WhatsApp Templates (per client):
   - Weekly Monday update template
   - Milestone message templates

**How it works technically:**

All templates stored in ClientBrief as structured JSON fields:
- ClientBrief.smsTemplates: Json — { bookedConfirmation, qualifiedFollowUp, dayBefore, hourBefore, noShow, reengagement: string[], phantomCallback }
- ClientBrief.callScriptOverrides: Json — { openingLine, closingLine, voicemail } (qualification/objections already in ClientBrief)
- ClientBrief.whatsappTemplates: Json — { weeklyUpdate, milestoneMessage }

**The UI — Template Editor in client sub-account:**

New tab: "Templates" in the client sub-account sidebar.

Shows all templates grouped by category:
- SMS Sequences
- Call Script  
- WhatsApp

Each template is an editable textarea with:
- Variable hints shown below: {{lead_first_name}}, {{business_name}}, {{appointment_time}}, {{agent_name}}
- Character count (SMS limit 160 chars)
- Preview button — shows rendered example with dummy data
- Save button — saves to ClientBrief immediately via PUT /api/clients/[blueprintId]/brief
- Reset to default button — restores the vertical default

**Default templates pre-populated by vertical:**

When a client is created, populate ClientBrief.smsTemplates with vertical-specific defaults:

Aesthetics defaults:
- bookedConfirmation: "Hi {{lead_first_name}}, lovely speaking with you! Your complimentary consultation at {{business_name}} is confirmed for {{appointment_time}}. We look forward to seeing you ✨"
- dayBefore: "Hi {{lead_first_name}}, just a reminder your consultation at {{business_name}} is tomorrow at {{appointment_time}}. Reply CONFIRM to confirm or CANCEL to reschedule."

Roofing defaults:
- bookedConfirmation: "Hi {{lead_first_name}}, great speaking with you! Your free roof survey with {{business_name}} is booked for {{appointment_time}}. Our surveyor will be with you then."

Personal injury defaults:
- bookedConfirmation: "Hi {{lead_first_name}}, thank you for speaking with us. Your free consultation with {{business_name}} is confirmed for {{appointment_time}}. Our team will be in touch shortly."

20 verticals — generate appropriate defaults for each.

**How templates flow into the system:**

- twilioService reads ClientBrief.smsTemplates for this blueprintId before sending any SMS
- speedToLeadService reads ClientBrief.callScriptOverrides before building the Retell dynamic variables
- The template variables ({{lead_first_name}} etc) are interpolated at send time with real lead data
- If a template field is empty — fall back to the vertical default from VerticalProfile

**The call script editor:**

Shows Sophie's current call script (from AIRepresentative.systemPrompt) in a textarea.
Agency owner can edit it directly.
On save: calls PUT /api/representative/[blueprintId]/script which:
1. Saves the new script to AIRepresentative.systemPrompt
2. Immediately calls updateRetellLlmPrompt to push it live to Retell
3. Returns confirmation: "Sophie's script updated and live"

Changes to the call script are live on the next call — no redeploy needed.

After building: tsc clean, commit, push. This is a core product feature — agency owners need this from day one.

---

### SPRINT 10C — Phantom Call-Back Loop + FSM Conversation States

**The Phantom Call-Back Loop:**
In src/lib/agents/roles/scheduler.ts, when a lead goes silent after initial contact:

- At minute 23 after last outbound SMS with no reply: fire a pattern-interrupt message: "Hey {{lead_first_name}}, my system cut out for a second — did you prefer morning or afternoon slots?"
- At hour 4 with no reply: shift channel — if SMS unanswered, trigger Sophie to call via Retell
- At hour 24: final nurture SMS: "Still happy to help whenever you're ready, {{lead_first_name}}. The slot is yours if you want it."
- After 3 attempts with no response: mark lead as DORMANT, add to 7-day re-engagement sequence

This recovers 15-20% of leads that standard systems write off.

**FSM Conversation States:**
Add explicit state tracking to the Scheduler role. Every lead has a conversationState field:

States: INITIAL → QUALIFYING → OBJECTION_HANDLING → NEGOTIATING → BOOKING → CONFIRMED → DORMANT → REENGAGED

Transitions are deterministic:
- INITIAL: Sophie calls, lead answers → QUALIFYING
- QUALIFYING: lead asks price → OBJECTION_HANDLING (price objection flow)
- QUALIFYING: lead says too busy → OBJECTION_HANDLING (time objection flow)  
- OBJECTION_HANDLING: objection resolved → NEGOTIATING
- NEGOTIATING: lead agrees to time → BOOKING
- BOOKING: slot confirmed → CONFIRMED
- Any state + no response 24h → DORMANT
- DORMANT + reply to re-engagement → REENGAGED

Each state has a defined response template. The LLM adapts the tone but the structure is deterministic. This prevents Sophie getting confused by edge cases.

Add to Lead model: conversationState String @default("INITIAL")
Migrate via Supabase MCP.

After building: tsc clean, commit, push.

---

### SPRINT 10C-B — Pre-Flight Creative Simulation (BUILD BEFORE SPRINT 11)

Before any ad creative is deployed to Meta, it must pass a simulation by 15 LLM consumer personas. No client capital is ever spent on unproven angles.

**The Simulation Engine:**
Create src/lib/services/creativeSimulator.ts

When the Creative Director generates ad variants, before pushing to Meta:
1. Generate 15 psychographic personas matching the client's target demographic from ClientBrief (age range, income level, skepticism level, time sensitivity, pain points)
2. Feed each creative asset (copy + hook + image description) to each persona
3. Each persona returns: { clickProbabilityScore: 1-10, primaryObjection: string, wouldConvert: boolean }
4. Aggregate: if mean score < 7.5 OR any policy flag raised → block the creative, route back to generator with exact objection list as modification constraints
5. Only assets scoring 7.5+ get added to the deployment queue

Store simulation results in a new CreativeSimulation table.
The agency owner sees simulation scores on every creative in the Higgsfield panel.

Schema:
model CreativeSimulation {
  id            String   @id @default(cuid())
  blueprintId   String
  tenantId      String
  creativeId    String
  personaScores Json     -- array of { persona, score, objection }
  meanScore     Float
  passed        Boolean
  blockedReason String?
  createdAt     DateTime @default(now())
}

---

### SPRINT 10D — Lead Fingerprinting & Hyper-Personalised Handoff (BUILD BEFORE SPRINT 11)

During the 45-60 second window between form submission and Sophie's first call, enrich the lead and personalise the approach.

Create src/lib/services/leadEnrichmentService.ts

When a lead webhook fires:
1. Extract first name, phone, email from the payload
2. In parallel (Promise.allSettled, never blocks the call):
   - Query a data enrichment API (Hunter.io or Clearbit) for company/role/income signals
   - Check if email domain is corporate (signals business owner vs consumer)
   - Run a basic affordability signal from postcode if available (UK postcode → ONS income data)
3. Build a LeadContextPackage: { tier: 'standard' | 'premium', signals: string[], enrichmentData: {} }
4. Save to Lead.enrichmentData (Json field)
5. Inject into Sophie's Retell dynamic variables BEFORE the call fires:
   - Standard lead: incentive frame ("secure your consultation slot + £50 voucher")
   - Premium lead (high-income signals): exclusivity frame ("limited VIP consultation, no discount language")

The call script must reference {{lead_tier}} and adapt tone accordingly.
Sophie should never mention a discount to a premium lead. Ever.

Add to Lead model: enrichmentData Json?, leadTier String @default("standard")
Migrate via Supabase MCP.

---

### SPRINT 10E — LTV Feedback Loop + POS Integration (BUILD BEFORE SPRINT 11)

This is the most commercially important build. Optimise for actual revenue, not just leads.

Create src/lib/services/posIntegrationService.ts

**Supported POS systems (aesthetics-specific):**
- Zenoti (most common UK aesthetics)
- Phorest
- Mindbody
- Manual webhook (for clinics without these systems)

**The flow:**
1. When a client is onboarded, agency owner connects their POS via OAuth or API key in the brief settings
2. When a patient completes a transaction in the POS, it fires a webhook to POST /api/webhooks/pos/[blueprintId]
3. The webhook receives: { patientEmail, transactionValue, treatmentType, date }
4. Match to Lead by email → update Lead.actualTransactionValue and Lead.ltv
5. Send the conversion value back to Meta via Conversions API (CAPI):
   - Event: Purchase
   - Value: actual transaction value
   - Currency: GBP
   - hashed email (SHA256, required by Meta)
6. This forces Meta's algorithm to optimise for high-value buyers, not just any leads

**The impact:**
After 50+ conversions with real transaction values flowing back to Meta, the algorithm finds more £3,500 patients instead of £150 ones. CPL may stay the same but revenue per lead increases dramatically.

**Schema additions:**
Add to Lead: actualTransactionValue Float?, ltv Float? (lifetime value accumulates)
Add to CampaignBlueprint: posProvider String?, posApiKey String? (encrypted), metaPixelId String?, metaAccessToken String?

New route: POST /api/webhooks/pos/[blueprintId] — receives POS events, matches leads, fires CAPI

Migrate via Supabase MCP.

---

### SPRINT 10F — Cross-Tenant Vector Knowledge Graph (BUILD BEFORE SPRINT 11)

The real moat. When a hook drops CPL 30% for one client, extract the psychological pattern and deploy it to all clients in that vertical before breakfast.

Create src/lib/services/vectorKnowledgeService.ts

**The architecture:**
Use OpenAI text-embedding-3-small to create vector embeddings of winning creative patterns.

When a creative achieves 30%+ CPL reduction sustained over 7 days:
1. Extract the psychological framework (NOT the specific words — the structural pattern)
   - What awareness state does it address?
   - What primary emotion does it trigger?
   - What objection does it pre-empt?
   - What proof mechanism does it use?
2. Strip all PII and client-specific identifiers
3. Generate a vector embedding of the psychological framework
4. Store in VectorKnowledge table with vertical tag

Every night at 02:00 (add to nightly cron):
1. For each LIVE blueprint, query VectorKnowledge for top patterns in their vertical
2. GPT-4o adapts the winning psychological framework to this client's specific offer and location
3. Adds the adapted creative brief to the client's creative queue
4. Logs: "Adopted winning hook structure from [vertical] network — adapted for [location]"

Schema:
model VectorKnowledge {
  id                String   @id @default(cuid())
  vertical          String
  psychPattern      String   -- plain English description of the psychological framework
  embedding         Bytes    -- vector embedding
  cplReduction      Float    -- % reduction that triggered extraction
  sourceCity        String?  -- anonymised
  deployedCount     Int      @default(0)
  createdAt         DateTime @default(now())
  @@index([vertical])
}

Add to vercel.json: { "path": "/api/cron/vector-knowledge", "schedule": "0 2 * * *" }

This is the compound intelligence loop. Every winning pattern across every client makes every other client better. A human agency cannot do this manually across 40 accounts. Your system does it while you sleep.

---

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

Q: 10D/10E need paid external APIs. How should I build them?
A: Option 1 — Build graceful shells. 

For leadEnrichmentService: corporate domain detection and UK postcode → ONS income data work without paid APIs. Build those now. Add Hunter/Clearbit as optional enrichment — if CLEARBIT_API_KEY or HUNTER_API_KEY env vars are set, use them. If not, skip silently and use domain/postcode signals only. Never block the call.

For posIntegrationService: build the full webhook receiver and Meta CAPI integration now. It no-ops gracefully if posApiKey is not set on the blueprint. The webhook endpoint exists and is ready — clinics just need to be pointed at it. Meta CAPI fires if META_PIXEL_ID and META_ACCESS_TOKEN are set on the blueprint, skipped if not.

Build everything properly. The infrastructure is there from day one. The paid APIs activate when the agency owner connects them — not before.
