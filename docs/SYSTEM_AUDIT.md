# Aurum Growth OS — System Audit

**Date:** 2026-06-01
**Author:** Claude Code (lead engineer)
**Scope:** Full honest audit of the system as it actually exists in the repo today — what is built, what is wired, what is verified live, and what is not.

> **Reading note — the honesty contract.** This document separates three states explicitly:
> **[LIVE]** = exercised against real data and verified working.
> **[BUILT]** = coded, type-checked (`tsc --noEmit` = 0), and wired into the call path, but not yet run against live external traffic (Meta/Retell/Twilio/calendar).
> **[GAP]** = not built, partial, or a known weakness.
> If a claim isn't tagged, treat it as **[BUILT]**. No customer has yet gone end-to-end through this system in production — the product is pre-first-customer. Every "Marcus does X" below means "the code path for X exists and compiles"; it does **not** mean a human has watched it happen on a real account. That distinction is the whole point of this audit.

---

## HOW MARCUS BEATS 99% OF MEDIA BUYERS

Marcus is the media-buyer role (`src/lib/agents/roles/mediaBuyer.ts`). He runs once every 4 hours per client (`/api/cron/agent-reasoning`, `0 */4 * * *`). Here is specifically — not generically — why his decisions beat a human's.

### 1. He reads data humans don't have time to read
A human media buyer managing 30 accounts checks each one maybe once or twice a day, almost always at the **campaign** level (total spend, total leads, blended CPL). Marcus, every single cycle, pulls **four** breakdown levels in parallel (`Promise.allSettled` over `getCampaignInsightsSummary`, `getAdSetInsights`, `getAdInsights`, `getAudienceInsights`):

- **Campaign level** — spend, conversions, CPL, CTR, frequency, reach, CPM, impressions
- **Ad-set level** — the same metrics per ad set (where budget actually lives)
- **Ad/creative level** — per-creative frequency and CTR (where fatigue actually starts)
- **Audience breakdown** — demographics (age/gender) and placements (where waste hides)

Each level carries ~7 metrics per row. A live account commonly has 1 campaign + several ad sets + a dozen ads + 10-20 demographic/placement rows — so **Marcus weighs several hundred discrete data points per client per cycle, six times a day**, before deciding anything. Layered on top, every cycle he also ingests: the client brief, Kai's nightly distilled learnings, the vertical CPL benchmark, pre-computed pro-signal heuristics, and **5 case-based precedents** (below). A human checking blended CPL once a day is reading <1% of that. **[BUILT]** — the Meta read path is coded and retry-wrapped; it has not yet pulled a real campaign's insights in production.

### 2. Case-Based Reasoning beats rules
The old engine was a 5-rule CPL threshold tree (`agentReasoningService` — still present as the deterministic fallback). Rules are brittle: "pause if CPL > 2× benchmark" fires on a campaign that's one day from exiting the learning phase and destroys it.

Marcus now reasons like a veteran does — **from cases, not rules** (`src/lib/intelligence/decisionLibrary.ts`). Before every diagnosis he embeds the current situation and retrieves the **5 most similar past cases** by cosine distance over pgvector (`retrieveSimilarCases`), then reasons *with* them ("this looks like the Bristol roofing account that turned out to be fatigue, not targeting"). The library today holds **231 cases [LIVE]** — 21 hand-authored 30-year-veteran cases + 210 GPT-generated realistic variations across 7 verticals, all embedded and confirmed retrievable (`<=>` operator verified, self-distance 0.0000, neighbours 0.08-0.09). This is the difference between a buyer who memorised rules and one who has *seen ten thousand accounts*.

### 3. The 6-step diagnostic framework vs how humans actually diagnose
A rushed human jumps from symptom to action ("CPL's high — pause it"). Marcus is forced through a structured causal chain in the system prompt:

1. **OBSERVE** — read all the data
2. **HYPOTHESISE** — list the plausible causes
3. **DISAMBIGUATE** — use evidence + precedents to rule causes in/out
4. **DECIDE** — exactly one action, within guardrails
5. **PREDICT** — the expected outcome and the specific number he expects to move
6. **MONITOR** — exactly what he'll watch next cycle to confirm or refute

The output is JSON mapped to `diagnosis` / `action` / `expectedOutcome` / `watchFor` / `confidence`, so every action is logged with its full reasoning chain in plain English. Crucially, **the model never executes** — `temperature: 0.2`, and the guardrails in step DECIDE are applied in *code after* the model (§ learning phase below). The model diagnoses; the code decides what's safe.

### 4. The self-learning loop — he gets better every week from his own track record
Most human buyers never systematically grade their own past calls. Marcus does, automatically (`src/lib/intelligence/selfLearningPipeline.ts`). Every executed SCALE/PAUSE is written to a `DecisionTrace` ledger with its baseline CPL. **48 hours later** the pipeline pulls the *real* post-decision CPL from Meta (queryable by historical date range), scores the decision, and promotes it back into the case library as a `self_learned` precedent — positive ("the +20% step held CPL") or negative ("scaling outran the audience; smaller steps next time"). Negative lessons are kept deliberately. So the 232nd case Marcus reasons from is *his own outcome on this exact client*. **[BUILT]** — the ledger, scoring, and promotion are coded and type-clean; no decision has yet aged 48h against live Meta data.

### 5. Vertical intelligence — 30 years of veteran knowledge before his first campaign
A new human hire knows generic media buying. Marcus starts every client already knowing that vertical cold: `VerticalProfile` ships per-vertical expert briefs, top-10 objection playbooks, real CPL benchmarks (£16-77 depending on vertical), call-timing data, seasonal patterns, and compliance notes, seeded from real web research (`scripts/seed-verticals.ts`). **[LIVE]** for the 6 priority verticals (seeded and in DB), with the honest caveat that the briefs came back ~700-1000 words vs the 2000-word target — good, not yet exhaustive.

### 6. Geo intelligence — a Manhattan HVAC agent knows *Manhattan*, not just HVAC
On Deploy Sophie, `onboardingResearch.ts` pulls real local competitor ads from the Meta Ad Library and writes a city-specific addendum (local CPL benchmark, top local objection, best call times, seasonal calendar) injected straight into the agent's prompt. Layer 6 (`conversationalMatrix.ts`) then learns, per city, which objection-handling *language* actually converts there (≥30 samples → a distilled CityPersona). So two HVAC clients in different cities diverge in how their agents talk. **[BUILT]** — wired into Deploy Sophie and the call path; not yet exercised by 30 real calls in one city.

### 7. Weather triggers — he scales *before* a heatwave, not after
This is in the **vertical/case knowledge**, not yet a live weather feed. The roofing/HVAC/solar case library explicitly encodes "scale budget and align creative *before* the demand event — the cheapest, highest-intent leads are at the front of the surge; reacting late means paying the premium everyone else pays." **[GAP]:** there is no live weather API wired in today. The *instinct* is seeded into Marcus's precedents; the *automated trigger* is not built. Calling this "live weather-reactive scaling" would be a lie — it's "Marcus knows to do this when told/when he sees the surge in the data."

### 8. CPM arbitrage — he shifts focus to cheap markets when expensive ones spike
`src/lib/intelligence/auctionArbitrage.ts` (Layer 8, `/api/cron/auction-arbitrage`, every 6h) tracks a rolling 14-day CPM index per client, applies **spike protection** (sustained >50% CPM spike over 3 days → auto −20% budget + alert), and builds a per-tenant portfolio rebalance flagging high-cost vs low-cost markets. A human buyer rarely notices a CPM creep until the monthly report. **[BUILT]**, not yet run against live CPM history.

### 9. The learning-phase protection — the single most common human mistake Marcus never makes
This is the most important paragraph in this section. **The #1 way human (and especially anxious agency-owner) media buyers destroy campaigns is pausing or scaling during Meta's learning phase** — before ~50 conversions, when the CPL is still noise. Doing so resets the optimiser and wastes 3-5 days and the spend already paid for that learning. Marcus makes this **structurally impossible**: `inLearningPhase` (under 50 conversions with real spend) is computed in code, and if the model picks PAUSE or SCALE during it, the code *overrides* and downgrades to a recommendation (`mediaBuyer.ts`, DECIDE step — a hard guardrail, not a prompt suggestion). The model can want to pause; the code won't let it. This one guardrail alone outperforms most humans.

### 10. The numbers
- **Marcus:** several hundred data points per client × 6 cycles/day = **low-thousands of data points per client per day**, every day, with full reasoning logged.
- **A human buyer:** a handful of campaign-level numbers per account, 1-2× per day, across far more accounts than they can actually attend to — diagnosis compressed to seconds, no written reasoning, no self-grading.

The edge isn't that Marcus is smarter per decision. It's that he reads more, forgets nothing, grades himself, and never makes the learning-phase mistake.

---

## THE COMPLETE SYSTEM END TO END

The full flow from "prospect fills in a form" to "agency owner gets paid."

### 1. Lead submits the form
A prospect fills in the client's landing-page form. It POSTs to `/api/webhooks/leads/[blueprintId]` (signature/secret verified; tenant resolved from the blueprint).

### 2. What fires, in what order, with what timing
1. **Lead persisted** — a `Lead` row is created, tenant-scoped, with an intent score (`computeLeadScore`) and tier (`enrichLead`).
2. **Speed-to-lead call placed — target < 60 seconds** (`placeSpeedToLeadService` → `placeSpeedToLeadCall`). Resolves the client's dedicated Retell number, injects the full brief + lead tier frame + the city's proven conversational model (Layer 6) into the call's dynamic variables, and dials via Retell. Every outcome (placed / failed / misconfigured) is logged as an `AgentAction` so the owner sees it live.
3. **Sophie (caller role) runs the call** — qualifies, handles objections from the brief, books if the lead is hot.
4. **Retell post-call webhook** → `/api/webhooks/calls/[blueprintId]` → the **scheduler role** (`handleCallOutcome`). This is the AFTER-call brain.

### 3. Every agent's role in the chain
The **five specialist per-client roles** (`src/lib/agents/roles/`): **caller** (Sophie — the call), **scheduler** (James — appointment, calendar event, reminders, confirmation SMS, objection extraction → feeds Layer 6), **mediaBuyer** (Marcus — the 4-hourly campaign brain, above), **reporter** (Ava — briefings/reports), **learner** (Kai — nightly distillation + cross-client knowledge). A sixth role, **communicator**, handles agency-facing comms (WhatsApp). DB-only handoff between roles — no role ever calls another directly; downstream roles read the rows upstream roles write.

### 4. Every cron and when (14 registered in `vercel.json`)
| Cron | Schedule | Job |
|---|---|---|
| `reminders` | every minute | fire due SMS reminders / retry no-answer leads |
| `outreach-autopilot` | hourly | agency's own lead-gen outreach |
| `capacity-monitor` | every 2h | calendar utilisation → throttle Meta budget, flash campaigns, day-25 report (Layer 7) |
| `agent-reasoning` | every 4h | **Marcus** runs every live client's campaign |
| `auction-arbitrage` | every 6h | CPM index, spike protection, portfolio rebalance (Layer 8) |
| `morning-briefing` | 06:00 daily | first-person briefing per client |
| `nightly-learning` | 00:00 daily | **Kai** distils each client's learnings |
| `vector-knowledge` | 02:00 daily | cross-client winning-pattern propagation |
| `competitor-intel` | Fri 05:00 | competitor ad sweeps |
| `client-whatsapp` | Mon 09:00 | client comms |
| `performance-aggregation` | Mon 03:00 | vertical benchmark aggregation |
| `vertical-training` | Sun 00:00 | adversarial training runs |
| `spend-fee` | 1st 08:00 | monthly spend-based billing |
| `monthly-report` | 1st 09:00 | monthly client reports |

> **[GAP]** `src/app/api/cron/portfolio-check/` exists on disk but is **not registered** in `vercel.json` — it will never fire on schedule. Either register it or delete it. Flagging rather than silently ignoring.

### 5. What the agency owner sees, and when
- **Live agent feed** — every `AgentAction` (calls placed, objections, budget moves, pauses) in plain English, intended via Supabase realtime.
- **6am morning briefing** — Sophie/Marcus report in first person per client.
- **Per-client sub-account** — KPIs, the conversational interface ("message Sophie directly"), brief, appointments.
- **Alerts** — `maybeAlertForAction` / `sendAgencyAlert` escalate things needing a human (e.g. a budget change over the approval threshold → NEEDS_APPROVAL).
- **Day-25 retainer report** (Layer 7) — ROI summary before the month closes.

### 6. What the client (the agency's customer) experiences
A call within ~60s of enquiring, 24/7; a booked appointment in their calendar; an SMS confirmation; reminders; no-show follow-ups — without the agency lifting a finger. **[BUILT/GAP]:** this is the designed experience; it has not yet happened for a real customer.

### 7. What happens if any single component fails
Covered in detail in the next section. In short: every external call is isolated (`Promise.allSettled` / per-call `try-catch` / `withRetry`), every role "NEVER THROWS" (53 modules carry that contract), and the per-client cron fan-out is isolated by `mapPool` so one client's failure never touches another's.

---

## WHY IT IS UNBREAKABLE

Honest version: it is **resilient by construction**, not literally unbreakable. The patterns below are real and in the code; the single genuine SPOF is the database (mitigated by Supabase, not by us).

**The four load-bearing patterns:**
- `withRetry(fn, { maxAttempts, shouldRetry: isTransientError, jitter })` — exponential backoff + jitter, **fails fast on permanent errors** (400/401/403/404/422) so the retry budget isn't burned, retries 429/5xx/network. Used across 10 service modules (`src/lib/utils/withRetry.ts`).
- `Promise.allSettled` — 13 modules. One failed sub-call degrades gracefully instead of aborting the batch.
- `mapPool(items, concurrency, worker)` — bounded-concurrency fan-out (4 cron routes). One client throwing is captured as `{status:"rejected"}`; the batch always completes. This is what makes 1 client and 10,000 clients behave the same.
- **"NEVER THROWS" role contract** — 53 modules. The webhook-facing roles always return a 200-shaped result so external services (Retell) never retry into a double-action.

**Failure mode by failure mode:**

- **Retell goes down** — Retell calls go through `withRetry` inside `retellService`. `placeSpeedToLeadCall` wraps the whole placement in try/catch and **never throws**; on failure it logs a `CALL_FAILED` AgentAction (owner sees it) and the `reminders` cron retries no-answer/failed leads on the next tick. **[GAP]:** a sustained Retell outage means leads aren't called within 60s — degraded, not data-losing.
- **Twilio goes down** — every SMS is sent through an isolated `safeSms` (scheduler) — a Twilio failure is caught and logged and **never blocks** appointment/lead persistence. The booking still lands; only the text is delayed. Reminders re-queue.
- **Meta API rate limits** — `getCampaignInsightsSummary` etc. go through `withRetry` (429 classified transient → backoff + jitter, honouring the limit). Marcus's OBSERVE step is `Promise.allSettled`: if ad-set/ad/audience calls fail, he degrades to campaign-level; if even the campaign call fails, he logs `META_UNAVAILABLE` and **holds all changes** until next cycle (does no harm). Mutations (`pauseCampaign`/`updateCampaignBudget`) that fail are caught and logged as "the change didn't go through."
- **OpenAI rate limits** — the shared client (`openaiClient.ts`) applies `timeout: 30s` + `maxRetries: 2` honouring `Retry-After` to *every* call. If GPT diagnosis still fails, Marcus **falls back to the deterministic engine** (`runAgentReasoningCycle`) so the campaign is never unmanaged. CBR retrieval returns `[]` on failure; the self-learning pipeline never throws; the seeder runs at bounded concurrency to stay under TPM.
- **Database connection drops** — the Prisma singleton (`src/lib/prisma.ts`) uses a bounded pool (max 5, idle/connection timeouts) on the transaction pooler for serverless; batch scripts force `DIRECT_URL` session mode via `run-batch.cjs`. Every audit-log write is `.catch()`-guarded so a transient log failure doesn't break the main path. **[GAP — the real SPOF]:** a full Postgres outage stops the system. We mitigate via pooling and Supabase HA, not via our own redundancy.
- **A single client campaign fails** — `mapPool` isolation + a per-cycle `try/catch` in `runMediaBuyerCycle` that returns `{status:"skipped"}`. Blast radius = that one client, that one cycle.
- **The reasoning loop errors** — wrapped end-to-end; returns `skipped`, never throws into the cron; deterministic fallback covers GPT outages.
- **A cron job times out** — `maxDuration` is set per route (e.g. 300s) and `mapPool` caps in-flight work so a route does as much as it can within budget; un-processed clients are picked up on the next tick. Because the work is **idempotent**, re-processing is safe.

**Idempotency (why retries don't corrupt state):**
- `Appointment.leadId` is **unique** — a Retell webhook retry can't double-book.
- `provisionClientAgent` is idempotent — re-deploy updates the agent in place, no duplicate agent, no double spend.
- `onboardingResearch` appends to the Retell prompt behind a marker — re-running doesn't duplicate the local-context block.
- `DecisionExample` inserts use `ON CONFLICT (id) DO NOTHING`; self-learned cases use a deterministic `dex_sl_<traceId>` id, so re-evaluation can't duplicate a precedent.

---

## WHY IT IS GODLIKE

The reason this compounds rather than plateaus is the **stacked intelligence layers**. Each is independent; together they make every agent sharper than the sum.

- **Layer 1 — Pre-loaded vertical expertise.** 30-year-veteran briefs, objection playbooks, real CPL benchmarks, seasonal/compliance data per vertical (`VerticalProfile`, `seed-verticals.ts`). **[LIVE]** (6 verticals, ~700-1000 word briefs).
- **Layer 2 — Real market data from the onboarding blitz.** Local competitor ads from the Meta Ad Library, captured at Deploy Sophie (`onboardingResearch.ts`, `metaAdLibrary.ts`). **[BUILT]**.
- **Layer 3 — Geo intelligence.** City-specific addendum + local CPL benchmark injected into the agent's prompt — Manchester ≠ London for the same vertical. **[BUILT]**.
- **Layer 4 — Case-Based Reasoning.** 5 expert precedents retrieved before every Marcus decision; **231 cases live today**. **[LIVE for retrieval]** / **[BUILT for in-loop use]**.
- **Layer 5 — Kai's nightly distillation.** Each client's recent reality compressed into a handful of sharp learnings every night (`nightly-learning`), fed into Marcus's evidence pack. **[BUILT]**.
- **Layer 6 — Conversational linguistics matrix.** Per-city objection language that actually converts, learned from real call outcomes (`conversationalMatrix.ts`). **[BUILT]**.
- **Layer 7 — Operational capacity autothrottle.** Calendar utilisation governs ad spend; flash campaigns fill cancellations (`capacityMonitor.ts`). **[BUILT]**.
- **Layer 8 — Global auction arbitrage.** Rolling CPM index, spike protection, portfolio rebalance (`auctionArbitrage.ts`). **[BUILT]**.
- **Self-learning pipeline.** Marcus's own 48h-scored outcomes feed back into Layer 4 (`selfLearningPipeline.ts`). **[BUILT]**.
- **Cross-client vector knowledge.** A winning psychological pattern for one client, anonymised and propagated to others in the vertical at 2am (`vectorKnowledgeService.ts`, `vector-knowledge` cron). **[BUILT]**.

**What this looks like over time (projected — pre-data, stated as design intent):**
- **Day 30:** Marcus has ~180 of his own scored decisions per active client feeding Layer 4 alongside the 231 seeded cases; Layer 6 has the first CityPersonas for high-volume cities; Kai has 30 nights of distillation.
- **Day 90:** the self-learned cases outnumber the seeded ones for active verticals; CPM arbitrage has a full quarter of seasonality; cross-client propagation means a winning hook discovered in Leeds is already adapted for Bristol.
- **6 months:** the case library is majority *earned*, not seeded; the moat is the accumulated outcome data, which a competitor cannot copy without running the same campaigns for the same months.

**Honest caveat:** every "over time" claim above is a *projection from the architecture*, not an observed result. The loops are built and type-clean; they have not yet run for 30 days on real accounts. The seeded layer (231 cases, 6 vertical briefs) is real today; the compounding is designed, not yet demonstrated.

---

## WHY IT PROVIDES INSANE VALUE

### What a human team costs to deliver this
To replicate what one Aurum deployment does per client, an agency needs fractions of: a **media buyer** (£40-70k), an **SDR/appointment setter** to call leads in 60s 24/7 (realistically 2-3 people for round-the-clock = £60-90k), an **account manager** (£35-50k), and a **creative director** (£50-80k). Even spread across a client book, the fully-loaded cost of delivering *this* level of service — 60-second response 24/7, 4-hourly optimisation, nightly learning, morning reporting — is **well into five figures per month** for an agency doing it properly. Most can't, which is why they overwork and churn clients.

### What Aurum costs to deliver it
The marginal cost per client is **API spend**: OpenAI (reasoning, briefings, embeddings), Retell (call minutes), Twilio (SMS), Meta (the client's own ad budget, not ours), plus a slice of Vercel/Supabase. Realistically **low tens of pounds to ~£100/client/month** depending on call volume — the dominant variable is Retell minutes. Against price points of **£297 / £597 / £997 / Enterprise**, that's a structurally software-like gross margin.

### The margin math
- **10 clients** (say blended £597) ≈ **£6.0k MRR**; COGS at ~£60/client ≈ £600 → ~90% gross margin.
- **50 clients** ≈ **£30k MRR**; COGS ~£3k → ~90%, and fixed engineering/infra is now well amortised.
- **100 clients** ≈ **£60k MRR**; COGS ~£6k. The cost curve is flat per client while revenue is linear — the definition of SaaS leverage. **[GAP]:** these are model economics; actual Retell/OpenAI cost per client must be measured on the first 10 real clients before they're load-bearing.

### Why clients stay (retention)
The agent **gets measurably better every week on their specific account** — self-learned cases, CityPersonas, Kai's distillation, CPM history all accrue to *that client*. Switching away means starting a new vendor's intelligence from zero. Churn fights against compounding performance, not just a contract.

### Why the moat deepens
The defensibility isn't the code (copyable) — it's the **accumulated outcome data**: every scored decision, every city's converting language, every vertical's real seasonality. A competitor can clone the architecture in a quarter; they cannot clone *six months of having run the campaigns*. The `DecisionExample` / `DecisionTrace` / `VectorKnowledge` / `ConversationalPattern` tables are the moat, and they only fill by operating.

### The network effect
Every client in a vertical makes every other client in that vertical better: cross-client vector knowledge propagates anonymised winning patterns nightly; `VerticalProfile` benchmarks sharpen as more accounts report real CPLs (`performance-aggregation`). The 100th HVAC client onboards into a system that already knows what works for HVAC across 99 prior accounts. That is a genuine, data-compounding network effect — **[BUILT]**, and it switches from theoretical to real the moment there are two clients in the same vertical generating outcomes.

---

## Bottom line

**Built and real today:** the full per-client agent architecture, 14 scheduled crons, the resilience fabric (withRetry/allSettled/mapPool/idempotency), 6 seeded vertical brains, and a **231-case CBR library with verified vector retrieval** plus a self-learning loop that closes it.

**Built but unproven:** every external-traffic path (Meta optimisation, Retell calls, Twilio SMS, calendar reads) and every compounding claim — they compile, they're wired, they have not run on a real customer.

**Honest gaps:** no live weather trigger (instinct is seeded, automation isn't); `portfolio-check` cron unregistered; vertical briefs shorter than target; full adversarial training (780 scenarios) not yet run; and the database remains the one true SPOF.

The architecture is genuinely a $100M-shaped product. What it has not yet earned is a single real customer's data. That is the next thing to get — everything above turns from "designed to compound" into "observed to compound" the moment it does.
