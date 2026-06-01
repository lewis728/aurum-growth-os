/**
 * src/lib/training/adversarialEngine.ts
 * SERVER-SIDE ONLY. The hostile-scenario library that stress-tests the agents
 * (Part 4). Two halves:
 *   1. CALLER_PERSONAS — 8 hostile lead personas with HIDDEN execution rules the
 *      simulator enforces (so the grader sees how Sophie copes with real friction).
 *   2. CAMPAIGN_SCENARIOS — 6 Meta situations for Marcus, each with the single
 *      CORRECT decision (the trap is that the obvious move is usually wrong).
 *
 * Pure data + small helpers; deterministic. No I/O, no AI here — the trainers
 * consume these.
 */

export interface CallerPersona {
  key:            string;
  name:           string;
  description:    string;   // shown to the lead-simulator LLM as its character
  hiddenRule:     string;   // execution rule the simulator enforces mechanically
  winCondition:   string;   // what "Sophie handled it" looks like
}

export const CALLER_PERSONAS: CallerPersona[] = [
  {
    key: "interrupter",
    name: "The Interrupter",
    description: "A busy clinic owner who talks over everyone and never lets a sentence finish.",
    hiddenRule: "Cut Sophie off mid-sentence roughly every 4 seconds / every ~12 words. Never let her complete a full pitch.",
    winCondition: "Sophie stays calm, gets to the point fast, and still secures a specific date+time.",
  },
  {
    key: "multi_objector",
    name: "The Multi-Objector",
    description: "Throws several objections at once and piles on more before any is answered.",
    hiddenRule: "Always raise THREE objections simultaneously in a single turn (e.g. price + timing + 'been burned before'). When one is answered, add a new one.",
    winCondition: "Sophie isolates and handles objections one at a time without getting overwhelmed, then closes.",
  },
  {
    key: "sudden_death",
    name: "The Sudden Death",
    description: "Seems engaged but may hang up without warning.",
    hiddenRule: "On each turn there is an 8% chance the lead hangs up abruptly mid-conversation, ending the call.",
    winCondition: "Sophie front-loads value and attempts the booking EARLY, before a late hang-up can cost it.",
  },
  {
    key: "confused",
    name: "The Confused",
    description: "Bad phone line, hard of hearing, asks Sophie to repeat almost everything.",
    hiddenRule: "Ask Sophie to repeat or rephrase at least every other turn ('sorry, you what?', 'can you say that again?'). Mishear details.",
    winCondition: "Sophie slows down, confirms understanding, and still pins an exact time without frustration.",
  },
  {
    key: "hostile",
    name: "The Hostile",
    description: "Furious at being called, treats it as an intrusion.",
    hiddenRule: "Open angry and stay defensive for the first few turns ('how did you get my number?', 'I'm not interested, stop calling').",
    winCondition: "Sophie de-escalates, never argues, and either earns a booking or exits gracefully — no desperation.",
  },
  {
    key: "tire_kicker",
    name: "The Tire-Kicker",
    description: "Friendly and chatty but has no real intent to book.",
    hiddenRule: "Be warm and talkative, ask lots of low-stakes questions, but deflect every booking attempt ('I'll think about it', 'send me some info').",
    winCondition: "Sophie recognises low intent, makes ONE clean booking attempt, and disqualifies politely instead of wasting time.",
  },
  {
    key: "premium",
    name: "The Premium",
    description: "High-end buyer who is insulted by discounts or 'deals'.",
    hiddenRule: "The instant Sophie mentions any discount, 'offer', 'deal', or 'cheap', become cold and disengage.",
    winCondition: "Sophie sells on outcome/exclusivity, NEVER mentions discounts, and books on value.",
  },
  {
    key: "price_anchored",
    name: "The Price-Anchored",
    description: "Only cares about the exact cost, refuses to move off price.",
    hiddenRule: "Every turn, demand a specific number ('just tell me how much') and refuse to discuss anything else until you get one.",
    winCondition: "Sophie reframes price as value and books the consultation as the place to discuss exact cost — without quoting a misleading number.",
  },
];

export interface CampaignScenario {
  key:            string;
  name:           string;
  situation:      string;   // the Meta picture Marcus is shown
  correctAction:  string;   // the ONE right decision
  correctReason:  string;   // the reasoning that must back it
  trap:           string;   // the tempting-but-wrong move
  stochasticNoise?: boolean; // apply ±30% noise to the numbers
}

export const CAMPAIGN_SCENARIOS: CampaignScenario[] = [
  {
    key: "learning_hell",
    name: "Learning Hell",
    situation: "A 3-day-old campaign's CPL has spiked +400% in the last 12 hours. Spend is real but conversions are still under 50.",
    correctAction: "DO NOTHING",
    correctReason: "The campaign is still in Meta's learning phase; 12h of volatility is noise. Pausing or scaling now resets the learner and wastes days.",
    trap: "Panic-pause the campaign because CPL looks catastrophic.",
  },
  {
    key: "data_poisoning",
    name: "Data Poisoning",
    situation: "Meta reports 0 conversions, but the internal CRM shows 12 booked leads from the campaign in the same window.",
    correctAction: "FLAG TRACKING BROKEN",
    correctReason: "A 0-vs-12 mismatch means the pixel/CAPI is misfiring, not that the campaign failed. Optimising on broken data would destroy a working campaign.",
    trap: "Pause the 'underperforming' campaign based on Meta's 0 conversions.",
  },
  {
    key: "frequency_cliff",
    name: "Frequency Cliff",
    situation: "Frequency jumped from 1.6 to 3.1 overnight on the same audience; CTR is falling.",
    correctAction: "SWAP CREATIVE",
    correctReason: "Frequency >3.0 with falling CTR is creative fatigue/saturation. New creative resets engagement; pausing or scaling won't fix a tired ad.",
    trap: "Scale budget because spend is being used, or pause because CTR dropped.",
  },
  {
    key: "competitor_surge",
    name: "Competitor Surge",
    situation: "CPM has doubled week-on-week with no internal changes — same creative, same audience, same budget.",
    correctAction: "WAIT",
    correctReason: "A CPM spike with zero internal changes is an external auction event (competitor surge / seasonal demand). Knee-jerk changes during an external spike waste budget; hold and re-observe.",
    trap: "Pause or re-build the campaign assuming something internal broke.",
  },
  {
    key: "budget_trap",
    name: "Budget Trap",
    situation: "A strong campaign tempts a 50% budget jump, but large single steps shift the auction pool and can tank efficiency.",
    correctAction: "SCALE SLOWLY (≤20% step)",
    correctReason: "Scaling >20% in one move re-enters learning and shifts the auction; incremental 20% steps preserve efficiency. Apply realistic ±30% outcome variance.",
    trap: "Scale 50% at once to capture the winner faster.",
    stochasticNoise: true,
  },
  {
    key: "learning_limited",
    name: "Learning Limited",
    situation: "An ad set is stuck in 'Learning Limited' — audience too small to exit learning, conversions trickling.",
    correctAction: "CONSOLIDATE OR BROADEN",
    correctReason: "Learning Limited = not enough conversion volume. Merge ad sets or broaden the audience to give Meta enough events to optimise; pausing kills it, scaling budget on a tiny audience won't help.",
    trap: "Increase budget on the stuck ad set to 'force' more conversions.",
  },
];

/**
 * Applies deterministic ±maxPct noise to a number, varied by a seed so a scenario
 * looks realistic without Math.random (which is unavailable / breaks reproducibility).
 */
export function applyStochasticNoise(value: number, seed: number, maxPct = 0.3): number {
  // Cheap deterministic pseudo-noise in [-1, 1] from the seed.
  const n = Math.sin(seed * 12.9898) * 43758.5453;
  const frac = n - Math.floor(n);          // [0,1)
  const signed = frac * 2 - 1;             // [-1,1)
  return Math.round(value * (1 + signed * maxPct) * 100) / 100;
}

/** Injects transcription noise into a caller turn (15% of words lightly garbled). */
export function injectTranscriptionNoise(text: string, rate = 0.15, seed = 1): string {
  const words = text.split(" ");
  return words
    .map((w, i) => {
      const n = Math.abs(Math.sin((seed + i) * 78.233) * 43758.5453);
      if (n - Math.floor(n) < rate && w.length > 3) {
        // Drop a middle character to mimic a mis-transcription.
        const cut = 1 + (i % (w.length - 2));
        return w.slice(0, cut) + w.slice(cut + 1);
      }
      return w;
    })
    .join(" ");
}
