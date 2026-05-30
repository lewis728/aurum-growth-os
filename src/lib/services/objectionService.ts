/**
 * src/lib/services/objectionService.ts
 * SERVER-SIDE ONLY.
 *
 * Extracts sales objections from a call transcript via GPT-4o, and aggregates
 * the most common objections per blueprint for briefings + the sub-account UI.
 */
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

/**
 * Extracts concise objection phrases from a call transcript.
 * Returns a normalised string[] (lower-cased, deduped). Never throws — returns
 * [] on any error so the caller (webhook) is never broken by this.
 */
export async function extractObjections(transcript: string): Promise<string[]> {
  if (!transcript || transcript.trim().length < 20) return [];

  try {
    if (!process.env.OPENAI_API_KEY) return [];
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You analyse sales call transcripts. Extract the prospect's objections — " +
            "reasons they hesitated or declined (e.g. price, timing, trust, need spouse approval). " +
            'Respond ONLY as JSON: {"objections": string[]}. Each objection is a short canonical ' +
            'phrase (2-4 words, lower case, e.g. "too expensive", "needs to think"). ' +
            "If there are no objections, return an empty array.",
        },
        { role: "user", content: transcript.slice(0, 12_000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { objections?: unknown };
    if (!Array.isArray(parsed.objections)) return [];

    const cleaned = parsed.objections
      .filter((o): o is string => typeof o === "string")
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0);

    return Array.from(new Set(cleaned));
  } catch (err) {
    console.error("[objectionService.extractObjections] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export interface ObjectionCount {
  objection: string;
  count:     number;
}

/**
 * Aggregates objections across a blueprint's leads (from callAnalysis.objections)
 * over the last `days`, returning the top `limit` most common. Never throws.
 */
export async function aggregateObjections(
  blueprintId: string,
  tenantId: string,
  opts: { days?: number; limit?: number } = {}
): Promise<ObjectionCount[]> {
  const days  = opts.days ?? 7;
  const limit = opts.limit ?? 3;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const leads = await prisma.lead.findMany({
      where:  { blueprintId, tenantId, createdAt: { gte: since } },
      select: { callAnalysis: true },
    });

    const counts = new Map<string, number>();
    for (const lead of leads) {
      const ca = lead.callAnalysis as { objections?: unknown } | null;
      if (!ca || !Array.isArray(ca.objections)) continue;
      for (const o of ca.objections) {
        if (typeof o === "string" && o.trim()) {
          const key = o.trim().toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }

    return Array.from(counts.entries())
      .map(([objection, count]) => ({ objection, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (err) {
    console.error("[objectionService.aggregateObjections] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
