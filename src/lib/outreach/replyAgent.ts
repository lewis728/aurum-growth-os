/**
 * src/lib/outreach/replyAgent.ts
 * SERVER-SIDE ONLY. The brain that handles an inbound prospect REPLY.
 *
 * Two responsibilities, in order:
 *   1. SAFETY GATE (deterministic, runs first): if the reply is an unsubscribe /
 *      "stop" / legal threat / clearly hostile, we NEVER auto-reply. We suppress
 *      and flag the owner. This protects the domain + keeps things compliant even
 *      in "fully auto" mode — the bot is not allowed to improvise into trouble.
 *   2. GPT-4o classifies intent + drafts a short, human, lowercase reply. When the
 *      prospect is interested/ready, the reply includes the Calendly link and the
 *      caller books the demo. Ambiguous-but-safe → a warm clarifying reply.
 *
 * Output is advice + a drafted message; the ROUTE decides to send (so sending is
 * testable and the safety policy lives in one place). NEVER THROWS.
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type ReplyIntent =
  | "interested"      // wants to know more / ready → send Calendly
  | "question"        // a real question we can answer, then nudge to book
  | "objection"       // hesitant (price/time/trust) → handle, then soft CTA
  | "not_interested"  // polite no → stop, no reply
  | "unsubscribe"     // remove/stop/legal → suppress + flag, NEVER reply
  | "auto"            // out-of-office / bounce / auto-responder → ignore
  | "unclear";        // can't tell → safe clarifier, or flag

export interface ReplyDecision {
  intent:        ReplyIntent;
  shouldSend:    boolean;      // send draftReply as an email reply?
  includeCalendly: boolean;    // did we put the booking link in?
  draftReply:    string;       // the message body (empty when shouldSend=false)
  unsubscribe:   boolean;      // honour suppression forever
  flag:          boolean;      // needs human eyes
  flagReason:    string;
  summary:       string;       // one line for the owner's WhatsApp ping
}

// Deterministic suppression triggers — checked BEFORE any LLM call.
const STOP_PATTERNS = [
  /\bunsubscribe\b/i, /\bremove me\b/i, /\btake me off\b/i, /\bstop emailing\b/i,
  /\bdo not (contact|email)\b/i, /\bopt[- ]?out\b/i, /\bgdpr\b/i, /\bcease\b/i,
  /\blawyer\b/i, /\blegal action\b/i, /\bsue\b/i, /\bspam\b/i, /\breport(ing)? you\b/i,
];

function tripsSafetyGate(text: string): boolean {
  return STOP_PATTERNS.some((re) => re.test(text));
}

interface RawClassification {
  intent: ReplyIntent;
  reply:  string;
  flag:   boolean;
  flagReason: string;
}

export interface ReplyContext {
  firstName:    string;
  businessName: string;
  replyText:    string;
  calendlyLink: string;
  agentName?:   string; // signs the reply (defaults to "Lewis")
}

export async function decideReply(ctx: ReplyContext): Promise<ReplyDecision> {
  const reply = (ctx.replyText ?? "").trim();
  const signer = ctx.agentName || "Lewis";

  // 1. Hard safety gate — never let the model talk us out of this.
  if (tripsSafetyGate(reply)) {
    return {
      intent: "unsubscribe", shouldSend: false, includeCalendly: false, draftReply: "",
      unsubscribe: true, flag: true, flagReason: "Opt-out / legal / complaint language detected",
      summary: `🚫 ${ctx.businessName} asked to stop / flagged — suppressed, no reply sent.`,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      intent: "unclear", shouldSend: false, includeCalendly: false, draftReply: "",
      unsubscribe: false, flag: true, flagReason: "Reply agent unavailable (no OpenAI key)",
      summary: `⚠️ Reply from ${ctx.businessName} — couldn't auto-handle (AI offline). Needs you.`,
    };
  }

  // 2. Classify + draft.
  const system =
    `You are ${signer}, a real founder replying to a cold-email reply from a prospect. ` +
    `You sound human, warm, casual, lowercase-friendly, never salesy or formal. Replies are SHORT ` +
    `(1-4 sentences). You book demos via a Calendly link. Output STRICT JSON only.`;

  const user = [
    `Prospect: ${ctx.firstName || "there"} at ${ctx.businessName}.`,
    `Their reply to my cold email:`,
    `"""${reply.slice(0, 1500)}"""`,
    ``,
    `Classify intent as one of: interested, question, objection, not_interested, unsubscribe, auto, unclear.`,
    `- interested/question/objection → write a short reply that moves toward a quick call. If they're interested or ready, INCLUDE this exact Calendly link inline: ${ctx.calendlyLink}`,
    `- not_interested → no reply needed (empty reply).`,
    `- auto (out-of-office/bounce) → no reply (empty).`,
    `- unclear → a one-line friendly clarifier, no link.`,
    `Set flag=true ONLY if a human really should look (confused, hostile, or high-value nuance you can't safely handle).`,
    ``,
    `Return JSON: {"intent": string, "reply": string, "flag": boolean, "flagReason": string}.`,
    `The reply must sound like a real person typed it on their phone. Sign off as "${signer}".`,
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.6,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<RawClassification>;

    const intent: ReplyIntent = (["interested","question","objection","not_interested","unsubscribe","auto","unclear"] as ReplyIntent[])
      .includes(parsed.intent as ReplyIntent) ? (parsed.intent as ReplyIntent) : "unclear";

    // Model said unsubscribe → treat like the hard gate.
    if (intent === "unsubscribe") {
      return {
        intent, shouldSend: false, includeCalendly: false, draftReply: "",
        unsubscribe: true, flag: true, flagReason: "Model classified as opt-out",
        summary: `🚫 ${ctx.businessName} wants out — suppressed.`,
      };
    }

    const draft = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    const noReplyIntent = intent === "not_interested" || intent === "auto";
    const flag = parsed.flag === true;
    // Guard the empty-link case: "".includes("") is always true, which would
    // falsely mark a reply as containing the Calendly link.
    const includeCalendly = ctx.calendlyLink.length > 0 && draft.includes(ctx.calendlyLink);
    const shouldSend = !noReplyIntent && !flag && draft.length > 0;

    const emoji = intent === "interested" ? "🔥" : intent === "objection" ? "🤔" : intent === "question" ? "💬" : "•";
    const summary = noReplyIntent
      ? `${ctx.businessName}: ${intent.replace("_", " ")} — no reply sent.`
      : flag
        ? `⚠️ ${ctx.businessName} replied (${intent}) — flagged for you: ${parsed.flagReason ?? ""}`
        : `${emoji} ${ctx.businessName}: ${intent}${includeCalendly ? " — sent your Calendly link" : " — replied"}.`;

    return {
      intent, shouldSend, includeCalendly, draftReply: shouldSend ? draft : "",
      unsubscribe: false, flag, flagReason: typeof parsed.flagReason === "string" ? parsed.flagReason : "",
      summary,
    };
  } catch (err) {
    console.error("[replyAgent] failed:", err instanceof Error ? err.message : err);
    return {
      intent: "unclear", shouldSend: false, includeCalendly: false, draftReply: "",
      unsubscribe: false, flag: true, flagReason: "Reply agent error",
      summary: `⚠️ Reply from ${ctx.businessName} — agent errored, needs you.`,
    };
  }
}
