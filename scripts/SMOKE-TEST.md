# Core-loop smoke test — prove "Sophie calls a lead in 60 seconds"

This proves the product's core moment end-to-end **without Meta**: lead webhook →
Retell outbound call → post-call webhook → Twilio SMS (+ Appointment if booked).
It needs only Retell + Twilio keys.

> ⚠️ This places a **real phone call and real SMS** to whatever number you pass.
> Use your own phone. Don't point it at anyone who hasn't agreed.

## Prerequisites (env, in `.env.local`)

| Var | Used for |
|-----|----------|
| `DATABASE_URL` | seed script (Prisma) |
| `LEAD_WEBHOOK_SECRET` | signs the test lead |
| `RETELL_API_KEY`, `RETELL_FROM_NUMBER` | the outbound call |
| `RETELL_AGENT_ID` *(or pass as arg)* | which Retell agent speaks |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | post-call SMS |
| `RETELL_WEBHOOK_SECRET` | verifies Retell's post-call webhook |
| `OPENAI_API_KEY` | (optional) briefings/objection extraction |

## Steps

1. **Run the app** (the webhooks must be reachable):
   ```
   npm run dev
   ```

2. **Seed a LIVE test client** (creates blueprint + agent + brief):
   ```
   node scripts/seed-test-client.js Sophie <retellAgentId>
   ```
   (omit `<retellAgentId>` if `RETELL_AGENT_ID` is set in env). It prints a
   `blueprintId` and the exact next command.

3. **Fire a lead at your own phone** (E.164):
   ```
   node scripts/test-webhook.js <blueprintId> +44XXXXXXXXXX
   ```
   Expect `200 {"success":true,...}`. Your phone should ring within ~60s.

4. **For the post-call half** (SMS / booking), Retell must be able to reach your
   post-call webhook at `/api/webhooks/calls/<blueprintId>`. Locally, expose it
   with a tunnel (e.g. ngrok) and set that URL as the agent's webhook in Retell,
   signed with `RETELL_WEBHOOK_SECRET`. On a booked outcome you get a confirmation
   SMS + an Appointment row; on qualified, a follow-up SMS.

## What proves what

| You see | Confirms |
|---------|----------|
| `200` from step 3 | lead webhook + HMAC + Lead row + speed-to-lead trigger |
| Phone rings | Retell call path (`createPhoneCall`, from/agent config) |
| `AgentAction` row `CALL_INITIATED` | call logged to the live feed |
| SMS arrives after the call | Twilio + post-call webhook wiring |
| `Appointment` row on "booked" | the full booked path |

## Cleanup

The seed uses tenant `pending:smoke-test` (override with `TEST_TENANT_ID`).
Delete test data by that tenantId when done.

## Known gap (flag)

`package.json` appears to contain a **duplicate `scripts` key**. It still parses
(JSON keeps the last one) so npm works, but it should be collapsed to a single
block. Left untouched here deliberately — verify and fix by hand.
