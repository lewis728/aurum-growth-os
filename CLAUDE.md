# Aurum Growth OS — Engineering Brief

## What we're building

AI fulfilment software for B2B marketing agencies. The product gives every agency owner a team of AI staff members — one per client — that manage Meta ads, call leads within 60 seconds, book appointments, send SMS follow-ups, and report back every morning in plain English.

This is not a dashboard. This is not a chatbot. This is an autonomous AI employee deployed per client.

The standard we're building to: a $100M ARR SaaS product. Every line of code, every UI component, every API route should be production-grade, performant, and scalable from day one. If it wouldn't pass a senior engineer's code review at Vercel, Linear, or Stripe — rewrite it.

---

## The core moment — never forget this

Agency owner clicks **"Deploy Sophie"**. Sophie goes live. From that moment:
- She calls every new lead within 60 seconds, 24/7
- She manages the Meta campaign autonomously — pausing underperformers, scaling winners
- She books appointments directly into the client's calendar
- She sends SMS follow-ups automatically
- She reports back to the agency owner every morning at 6am in first person

The agency owner's only job is getting new clients. Sophie handles everything else.

When this works end-to-end, we have a product people will pay £297-£997/month for without hesitation.

---

## Tech stack

- **Framework**: Next.js 14 App Router — server components for data fetching, client components for interactivity
- **Database**: Prisma 7 + PostgreSQL (Supabase project: zugbafsnhwntpzwdkqvd)
- **Auth**: Clerk v5 — JWT propagation is async, orgId is often null on first load
- **Styling**: Tailwind CSS + CSS custom properties (globals.css) — dark by default, light mode via `[data-theme="light"]`
- **AI**: OpenAI GPT-4o for agent intelligence, reasoning, briefings, reports
- **Voice**: Retell AI — outbound calls within 60 seconds of lead submission
- **SMS**: Twilio — post-call, confirmations, reminders, no-show follow-ups
- **Ads**: Meta Marketing API v20.0 — campaign management, insights, lead retrieval
- **Creative**: Higgsfield — AI video ad generation triggered by creative fatigue
- **Billing**: Stripe — 4 tiers (Starter £297, Growth £597, Agency £997, Enterprise custom)
- **Hosting**: Vercel — production, cron jobs every 4h (agent reasoning), 6am (briefings), daily (reports)
- **Realtime**: Supabase realtime — live agent activity feed, no polling

---

## Critical rules — never break these

### Auth
```typescript
// ALWAYS use this pattern — never orgId alone
const { userId, orgId } = await auth()
if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
const tenantId = orgId ?? `pending:${userId}`
```
orgId is null until Clerk's JWT cookie propagates after setActive(). The pending:userId pattern is how we handle this. Every single API route must use it.

### TypeScript
- Zero `any` types — ever. Use proper types or `unknown` with type guards
- Run `npx tsc --noEmit` before every commit
- If tsc errors, fix them — never suppress with `@ts-ignore`

### CSS
- Never hardcode colours in components — always use CSS variables: `var(--bg)`, `var(--text-1)`, `var(--gold)` etc
- All variables defined in `src/app/globals.css`
- Dark mode default, light mode via `[data-theme="light"]` on `<html>`
- Design target: Vercel/Linear/Apple — clean, minimal, premium dark

### Git
- Always: `git add -A && git commit -m "descriptive message" && git push origin main`
- Commit messages: `feat:`, `fix:`, `refactor:`, `chore:` prefixes
- Never commit `.env.local` — it's gitignored

### Database
- Never run `prisma migrate dev` in production — use `prisma migrate deploy`
- Always use `@@index` on tenant-scoped queries
- Every model needs `tenantId` for multi-tenant isolation

---

## Database models

| Model | Purpose |
|-------|---------|
| AgencyProfile | One per agency owner — name, branding, subscription |
| CampaignBlueprint | One per client — all campaign config, Meta IDs, status |
| AIRepresentative | One per blueprint — agent name, voice, personality |
| AgentAction | Append-only audit log of every agent decision |
| AgentInstruction | Natural language rules from agency owner per client |
| Lead | Every lead that comes through a landing page or form |
| Appointment | Every booked appointment — linked to Lead |
| ScheduledReminder | SMS queue — fires via cron every minute |
| MetaConnection | OAuth tokens per tenant (AES-256 encrypted) |
| CalendarConnection | Google Calendar or Calendly tokens per tenant |
| VerticalProfile | Anonymised performance benchmarks per vertical |
| AgencyBranding | Custom domain, colours, logo for white-label |
| AgencySubscription | Stripe subscription state |
| MonthlyReport | Generated reports sent to agency's clients |

---

## Agent system — how it works

Each CampaignBlueprint has one AIRepresentative. That representative is "Sophie" or "Marcus" or whatever the agency owner names them.

**Reasoning loop** (every 4 hours via cron):
1. Pull 48h Meta Insights for the campaign
2. Compare CPL against vertical benchmark from VerticalProfile
3. Check active AgentInstructions from the agency owner
4. Parse instructions with GPT-4o to extract thresholds
5. Decision tree: pause if CPL > 2x benchmark, scale if CPL < 0.75x benchmark, flag low CTR
6. Execute action via Meta API
7. Log to AgentAction with full reasoning in plain English

**Morning briefing** (6am via cron):
- GPT-4o generates a first-person briefing from the agent
- Stored in CampaignBlueprint.lastBriefingText
- Shown at top of per-client sub-account view

**Conversational interface**:
- Agency owner can message Sophie directly in each client sub-account
- POST /api/agent/chat — streams SSE response
- If message contains an instruction, saved to AgentInstruction automatically
- Agency chief of staff at dashboard level via /api/agent/agency-chat

---

## Current build priorities

1. **Add client wizard** — 5-step new campaign, 3-step takeover. Most important UX in product.
2. **Deploy Sophie button** — the emotional core moment. One click activates everything.
3. **Retell 60-second call trigger** — form submit → call within 60s
4. **Twilio SMS sequences** — post-call, confirmation, reminders, no-show
5. **Live agent feed** — Supabase realtime, no polling
6. **Stripe billing UI** — billing page, upgrade flow, tier enforcement
7. **Higgsfield creative UI** — generate, preview, attach to campaign
8. **Meta spend data in UI** — real numbers from Meta Insights in KPI strips

---

## Design system

Target aesthetic: **Vercel meets Apple**. Premium dark glass. Every pixel intentional.

```css
--bg: #000000
--surface-1: #0a0a0a
--surface-2: #111111
--surface-3: #1a1a1a
--border: rgba(255,255,255,0.06)
--border-strong: rgba(255,255,255,0.10)
--text-1: #ffffff
--text-2: #a1a1aa
--text-3: #52525b
--gold: #C9A84C
```

- Font: Inter for UI, JetBrains Mono for numbers/code
- Cards: `background var(--surface-1)`, `border 1px solid var(--border)`, `border-radius 8px`
- Hover states: border lightens to `var(--border-strong)`
- Status indicators: coloured dots, never filled badges
- Numbers: always JetBrains Mono, slightly larger than surrounding text
- Spacing: generous — 24px between sections, 16px inside cards

---

## How to work on this codebase

When given any task:

1. **Read first** — read every file that's relevant before writing a single line
2. **Think broader** — identify anything broken, inconsistent, or improvable in the files you're reading, even if it wasn't in the brief
3. **Flag before building** — if you spot a potential issue (auth missing, TypeScript problem, race condition), say so before you start
4. **Fix what you see** — if something is clearly wrong in a file you're already in, fix it. Mention what you fixed.
5. **Build to production standard** — not "this works", but "this is how Stripe would build it"
6. **Test types** — `npx tsc --noEmit` after every change, fix everything before committing
7. **Suggest next steps** — after finishing, tell me what you noticed and what should be built next

The goal isn't to complete tasks. The goal is to build a $100M product.

---

## What this product means

Agency owners work 80-hour weeks trying to fulfil for their clients. They're managing ads, calling leads, chasing appointments, writing reports — all manually. Aurum gives them a team of AI staff that do all of that better than any human, 24/7, for a fraction of the cost.

When Sophie calls a lead 45 seconds after they fill in a form at 11pm on a Sunday and books them in for a consultation on Monday morning — that's the product working. That's what we're building toward.

Every feature, every API route, every UI component exists to make that moment real.
