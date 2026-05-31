# Aurum Growth OS — Status & Handoff

> Cold-start handoff. A fresh session or engineer should be able to pick up from
> this file alone. **Read `CLAUDE.md` first** — it is the source of truth on stack,
> auth pattern, design system, and working rules.

## 1. What this project is
AI fulfilment software for B2B marketing agencies. Each client gets a dedicated AI
"employee" (Sophie/Marcus/etc.) that calls leads within 60s, manages Meta ads,
books appointments, sends SMS, and reports to the agency owner.

**Operator context:** the owner has never run ads. They intend to dogfood this
building their own agency, then sell as SaaS. They have API keys but **no real
clients yet**, and are **waiting on Meta app approval**. They are happy with a
human-approval gate on anything that spends money.

## 2. What's built & type-checked
All of the below is committed and passes `npx tsc --noEmit` (0 errors).

**Sprints 3–15:** Add-Client wizard + tiers, Retell 60s call trigger + retry,
Twilio SMS sequences + no-show, live agent feed (Supabase realtime), tiered Stripe
billing UI + owner-gated routes, Meta spend in KPIs, Higgsfield creative UI +
refresh banner, lead scoring UI, objection logging, seasonal campaign suggestions,
white-label branding, team seats/roles.

**Sprint 3B — Per-client CRM pipeline (2026-05-31):**
- Migration (applied to prod via Supabase MCP): `Lead.pipelineStage` (default
  "new"), `convertedAt`, `dealValue`, + `@@index([tenantId, pipelineStage])`.
  `source` already existed.
- `src/lib/crm/pipeline.ts`: stages new→called→qualified→booked→showed→converted
  + sub-states (no_answer/no_show/not_interested/retry_queue). `derivePipelineStage`
  is the single source of truth — stage is DERIVED from `status` + appointment
  outcome (no scattered per-event writes to drift). Pure + total.
- `GET /api/leads`: returns each lead's derived stage + appointment, and lazily
  reconciles the stored `pipelineStage` column when it drifts (best-effort, never
  blocks the response) so God Mode's indexed aggregate stays accurate.
- `POST/DELETE /api/leads/[leadId]/convert`: the one explicit transition — owner
  marks a won deal (+ optional dealValue); DELETE un-converts. Tenant-scoped.
- `PipelineBoard.tsx`: stage-column board, score dots (green 7-10/amber 4-6/red
  1-3), time-in-stage, expandable card (call summary + appointment + convert).
- God Mode: new **Pipeline value** KPI = open appointments × avg client value,
  computed from the authoritative Appointment table (not the lazily-synced column).
- **DEFERRED (tooling glitch, NOT done):** mounting `PipelineBoard` inside
  `ClientSubAccount.tsx` — the edit channel corrupted the file mid-edit (duplicated
  a line); reverted to known-good to protect it. The board + API are live; the
  sub-account still renders the old leads table until the mount lands. Per-lead
  AgentAction timeline also deferred — AgentAction has no `leadId` column, so the
  card shows callAnalysis summary + appointment instead (honest data we actually have).

**Sprint 5 — ROI reporting + per-client reports (2026-05-31):**
- `monthlyReportGenerator.ts` (already existed — enhanced, not created):
  - **Revenue** = booked × `ClientBrief.averageClientValue` (works without Meta);
    **ROI** = revenue / ad spend (null when spend unknown); per-blueprint + totals.
  - **Month-on-month trend** via `computeTrend` reading the prior `MonthlyReport`
    (leads / booked / revenue / CPL deltas; negative CPL delta = cheaper = good).
  - GPT-4o owner report now leads with the money + trend.
  - **Per-client white-label reports**: each live client with a `clientContactEmail`
    gets its own client-facing GPT report emailed under the agency brand via new
    `emailService.sendClientReport` (no Aurum/vendor names; `replyTo` = agency
    support email). Isolated per client; never blocks the owner report.
- Cron aligned to the brief: monthly-report `0 8` → `0 9 1 * *` (9am, 1st).
- **Honest gaps:** (1) per-client reports are emailed but NOT persisted per-client
  (the tenant aggregate is persisted; per-client persistence needs a `blueprintId`
  on MonthlyReport — deferred, noted not silently skipped). (2) Email delivery
  unexercised — needs RESEND_API_KEY + FROM_EMAIL in prod and a real send.
  (3) Cron is monthly (1st) so not runtime-verifiable until then; logic is
  tsc-clean and the revenue/ROI math is unit-reasoned.

**Sprint 4 — Slack alerting (2026-05-31):**
- `src/lib/services/alertService.ts`: `notifySlack(url, alert)` (Block Kit, never
  throws, 4xx not retried), `sendAgencyAlert(tenantId, alert)` (reads
  `AgencyProfile.slackWebhookUrl`), `maybeAlertForAction(...)` — the single hook
  the action loggers call, so alerting is a property of logging an alert-worthy
  AgentAction.
- Alert-worthy: CLIENT_AT_RISK, NEEDS_APPROVAL, META_UNAVAILABLE,
  CALL_FAILURE_SPIKE, CPL_CRITICAL, LEAD_DROUGHT.
- Wired into live emitters: `agentReasoningService.logAction` (NEEDS_APPROVAL,
  META_UNAVAILABLE) + `chiefOfStaff` (CLIENT_AT_RISK / portfolio alerts), fire-and-forget.
- `PATCH/GET /api/agency/notifications` (save/clear webhook + optional live test;
  GET returns only `slackConfigured`, never the secret) + `/settings/notifications`
  page with `NotificationsConfig`.
- **Honest gap:** CALL_FAILURE_SPIKE / CPL_CRITICAL / LEAD_DROUGHT are defined but
  NOT yet emitted — they need aggregate monitoring + Meta breakdown data from the
  Sprint 7 media-buyer rebuild. Slack delivery not yet exercised against a real
  webhook.

**⚠️ Production finding (2026-05-31, Vercel logs):** `/api/cron/reminders` and
`/api/dashboard/metrics` threw repeated `prisma:error` 500s ~07:37–08:10 then
stopped (a `200` at 09:02). Looked transient (deploy-window cold Prisma), but
unconfirmed — re-check the next time the reminders cron runs; if it recurs, it's a
real bug to fix before Sprint 5.

**Build 1 — Dual Agent Architecture:**
- `src/lib/agents/clientAgent.ts` — `runClientAgentCycle(blueprintId, tenantId)`,
  per-client account manager; enforces budget hard limit + `NEEDS_APPROVAL` threshold.
- `src/lib/agents/chiefOfStaff.ts` — `runChiefOfStaffCycle(tenantId)`, cross-portfolio
  COO; writes `AgentAction` with `blueprintId: null`
  (`PORTFOLIO_BRIEFING`, `CLIENT_AT_RISK`, `UPSELL_OPPORTUNITY`, `PORTFOLIO_INSIGHT`).
- `agentReasoningService.ts` made brief-aware (shared engine, deliberately not forked
  into a class).
- New cron `/api/cron/portfolio-check` (vercel.json `0 */6 * * *`); `agent-reasoning`
  now calls `runClientAgentCycle`.
- `AgentAction.blueprintId` is now nullable (migration `20260531_add_client_brief_and_agency_fields`).

**Client Context Engine:**
- `src/lib/agents/clientContext.ts` — `buildClientContext(blueprintId)` assembles
  business basics + `ClientBrief` into one `promptBlock` + guardrails. **Wired into
  all 4 agent surfaces:** reasoning loop, client chat, creative generation, morning briefing.
- `ClientBrief` model gained `targetCplGbp`, `complianceNotes`, `websiteSummary`
  (migration `20260531_add_client_brief_knowledge_fields`).
- Capture: `GET/PUT /api/clients/[blueprintId]/brief` (tenant-scoped) +
  `ClientBriefPanel.tsx` editor in the sub-account.
- Client-create seeds a starter `ClientBrief` from the website scrape.
- `businessHours` was added then **removed** — it contradicted the core promise
  (Sophie calls 24/7, unconditionally).

## 2a. ✅ Core loop VERIFIED working end-to-end (2026-05-31)

Proven on the live Vercel deployment + production Supabase, against blueprint
`cmpting4e000004l5gk6hmmz0` ("lewis roofing", agent "bella"), firing at a real phone:

- ✅ **Form → leads webhook → Lead created** (HMAC verified, `200`, lead scored)
- ✅ **60-second Retell call** — real outbound call placed, `CALL_INITIATED` logged,
  `retellCallId` persisted, phone rang and the agent spoke
- ✅ **Post-call webhook → Appointment created** (atomic `$transaction`)
- ✅ **Lead status → `booked`**
- ✅ **Confirmation SMS delivered** (Twilio, first live send)
- ✅ **Reminder queue created** — 3 `ScheduledReminder` rows (confirmation +
  day-before + hour-before), pre-rendered and addressed

Two real production bugs were found and fixed during this test:
- **`setImmediate` on serverless** — both webhooks deferred their core work
  (booking/SMS in calls; automations in leads) until *after* the `200`. Vercel
  freezes the function once the response is sent, so that work silently never ran.
  Both now `await` the work before responding (commits `0df6b7c`, `5d783e9`).
  Without this, no booking or automation would EVER fire in production.
- **`RETELL_FROM_NUMBER`** was stored with a double `+` (`++447…`) → Retell 404.
  Corrected to a single `+`.

Test tooling (kept in repo): `npm run fire-lead` (signed lead) and
`npm run fire-postcall` (signed Retell post-call payload). Admin helper
`/api/admin/set-blueprint-live` flips a blueprint to LIVE for testing.

## 3. What is NOT done / known gaps
- **Core loop is verified (see §2a); broader runtime coverage is still partial.**
  Most non-core paths (Meta, Stripe, realtime, reports, crons) have NOT been
  observed firing — only the form→call→book→SMS loop has. See §6 for the backlog.
- **Sprint 10 WhatsApp send is NOT implemented** — only `clientContactName` /
  `clientWhatsApp` capture fields exist. `twilioService` has no `sendWhatsApp`; the
  monthly-report cron does not message clients.
- **Meta-dependent paths unverified** — spend/insights/campaign create/pause/scale.
  Blocked on Meta app approval. The `getCampaignInsights` signature was already wrong
  once and fixed; treat all Meta wiring as untrusted until exercised.
- **Agent intelligence is shallow** — the reasoning loop is a ~5-rule CPL threshold
  tree, not deep "why it's working" diagnosis. Real depth needs ad-set/creative/
  audience breakdown data from Meta (not yet requested) + GPT reasoning over it.
  `VerticalProfile` benchmarks are GPT *estimates* until real campaign data accumulates.
- **Migrations need `prisma migrate deploy` in prod** (never `migrate dev` per CLAUDE.md).
- **Clerk custom roles** (owner/manager/viewer) must be configured in the Clerk
  dashboard or non-admin roles won't resolve.

## 4. How to verify the core loop (needs only Retell + Twilio, NOT Meta)
The core moment — lead → 60s call → SMS → booking — is testable without Meta, since
Meta is only the lead *source* in prod. Flow:
`POST /api/webhooks/leads/[blueprintId]` (HMAC-signed) → `speedToLeadService` →
Retell `createPhoneCall` → post-call webhook `/api/webhooks/calls/[blueprintId]` →
Twilio SMS + Appointment. Requires a LIVE blueprint and a tunnel (e.g. ngrok) for
Retell's post-call webhook. This is the highest-value verification available pre-Meta.

> Note: an earlier smoke-test harness (commit `c777c3c`) was reverted because it
> referenced a non-existent script and contained a fabricated claim. If a smoke test
> is wanted, build it fresh — reading every referenced file first. The seed-client
> idea is sound (LIVE blueprint + brief under tenant `pending:smoke-test`); the
> execution was rushed.

## 5. Working discipline — failure modes to avoid
1. **Never batch `git commit` in the same parallel tool block as the edits.** Parallel
   calls have no ordering; the commit runs first, fails "nothing to commit," and
   cancels the batch. One write per step; commit separately; verify `tsc` before every
   commit and `git rev-parse HEAD == origin/main` after every push.
2. **Edits silently fail** when `old_string` doesn't match the real file. After every
   edit, grep to confirm the change actually applied **before** writing the commit message.
3. **Read before referencing.** Do not assert facts about a file you haven't read
   (CLAUDE.md rule #1). Two false claims shipped this way before being caught.
4. Git/tsc/prisma commands here need `dangerouslyDisableSandbox: true`.

## 6. Test backlog — still to verify at runtime

The core loop is proven (§2a). These remain unverified:
- **Real Retell call completing and firing the post-call webhook automatically** —
  so far the post-call leg was proven via a *simulated* signed payload
  (`npm run fire-postcall`). Need a real call where Retell itself POSTs
  `/api/webhooks/calls/[blueprintId]`. **Requires the Retell agent's webhook URL +
  signing secret to be configured to match `RETELL_WEBHOOK_SECRET`.** (Could not be
  verified from here — no Retell dashboard/API access.)
- **Google Calendar booking** — `createCalendarEvent` is wired into the booking path
  but skips (logs a warning) unless the tenant has a Google Calendar OAuth
  connection. Needs OAuth connected, then a booking, to confirm the event lands.
- **Morning briefing delivery at 6am** — `morningBriefingService` + the 6am cron are
  built but never observed running. Verify it generates + stores `lastBriefingText`
  and shows in the client sub-account.
- **Reminders cron firing day-before & hour-before SMS** — the 3 reminder rows are
  queued (proven), but `/api/cron/reminders` sending them on schedule is untested.
  The immediate confirmation reminder (`sendAt` = now) is the quickest check.

## 8. Later build priorities (per CLAUDE.md, once testing settles)
1. Complete ClientBrief capture in the **onboarding wizard** (done — see the
   `/onboard/[blueprintId]` flow; verify it at runtime).
2. When Meta clears: breakdown-level insights + deeper GPT reasoning — the "knows
   exactly why it's working" capability, the real differentiated product.
3. Implement the deferred Sprint 10 WhatsApp send, or formally drop it from scope.
4. God Mode portfolio dashboard (surface the chief-of-staff `blueprintId: null`
   actions, which currently render nowhere).

## 9. ⚠️ TEMP overrides to restore before launch

The subscription/billing gate is **disabled** for the solo test environment (no
Stripe connected). **These MUST be restored before opening to paying customers** —
otherwise anyone can use the platform and deploy clients without paying. Every site
is marked in-code with the comment:
`// TEMP: disabled for solo test env — restore before opening to paying customers`.

### Cleanest restore: revert the two commits
```
git revert 7e4ec76   # server-side gates (canLaunchCampaign, isPlatformActive, create-route 402)
git revert 5872f85   # client-side gate (useSubscriptionAccess overlay)
```
(Resolve any conflicts against later changes, then `npx tsc --noEmit` before pushing.)

### Or restore each site by hand
| File | Function / site | Current (TEMP) | Restore to |
|---|---|---|---|
| `src/hooks/useSubscriptionAccess.ts` | `useSubscriptionAccess()` | returns hard-coded `active` `PERMISSIVE_ACCESS`; SWR fetch + `deriveState` deleted | re-add the SWR fetch of `/api/billing/status` + `deriveState` + `canLaunch`/seat-cap logic |
| `src/lib/access/subscriptionGuard.ts` | `canLaunchCampaign()` | returns `{ allowed: true, state: "active" }` | restore the no-subscription / past_due / trialing-3-seat-cap / active branches (consts `TRIAL_SEAT_CAP`, `INACTIVE_STATUSES` still present) |
| `src/lib/services/stripeService.ts` | `isPlatformActive()` | returns `true` | restore: active → true; trialing → within `trialEndsAt`; else false |
| `src/app/api/clients/create/route.ts` | post-validation gate | 402 gate removed; `getSubscriptionStatus`/`isPlatformActive` import removed | re-add `import { getSubscriptionStatus, isPlatformActive }` and the `if (!isPlatformActive(...)) 402` block (a leftover `// (Was: 402 ...)` comment marks the spot) |

The original implementations of all four are in git history (pre-`5872f85`).

### Also tied to billing (verify, not yet disabled)
- `/api/billing/checkout` and `/api/billing/portal` are owner-gated via `isOwner()` — fine to leave.
- The dashboard **Billing** tab and `BillingCard` still render the real (tiered) pricing UI; they read `/api/billing/status` which is unaffected by these overrides.
