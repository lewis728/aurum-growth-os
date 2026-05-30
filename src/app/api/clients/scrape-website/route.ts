/**
 * POST /api/clients/scrape-website
 *
 * Fetches a business website, strips HTML to plain text, then uses GPT-4o
 * to extract structured business intel. Called on URL blur in the wizard.
 * Result auto-populates the offer field and is saved to CampaignBlueprint.deployment.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

export interface ScrapeResult {
  description:   string;
  offer:         string;
  targetCustomer: string;
  tone:          string;
  sellingPoints: string[];
}

function stripHtml(html: string): string {
  // Remove scripts, styles, and tags; collapse whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3000);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });
  }

  let url: string;
  try {
    const body = (await req.json()) as { url?: string };
    url = body.url?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Normalise — add https if missing
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // ── Fetch the website ─────────────────────────────────────────────────────
  let pageText: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AurumBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    pageText = stripHtml(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    console.error("[scrape-website] Fetch error:", msg);
    return NextResponse.json({ error: `Could not read website: ${msg}` }, { status: 422 });
  }

  if (!pageText.length) {
    return NextResponse.json({ error: "No readable content found on page" }, { status: 422 });
  }

  // ── Extract business intel via GPT-4o ─────────────────────────────────────
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      temperature:     0,
      max_tokens:      400,
      response_format: { type: "json_object" },
      messages: [
        {
          role:    "system",
          content:
            "You are reading a business website. Extract key information to brief an AI sales agent. " +
            "Return JSON only: { description, offer, targetCustomer, tone, sellingPoints: string[] }. " +
            "description: 1-2 sentence summary of what the business does. " +
            "offer: their main product or service. " +
            "targetCustomer: who they sell to. " +
            "tone: e.g. professional, friendly, clinical, luxury. " +
            "sellingPoints: up to 4 key differentiators.",
        },
        {
          role:    "user",
          content: `Website text:\n\n${pageText}`,
        },
      ],
    });

    const raw    = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<ScrapeResult>;

    const result: ScrapeResult = {
      description:    parsed.description?.trim()    || "",
      offer:          parsed.offer?.trim()          || "",
      targetCustomer: parsed.targetCustomer?.trim() || "",
      tone:           parsed.tone?.trim()           || "professional",
      sellingPoints:  Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints.slice(0, 4) : [],
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[scrape-website] GPT error:", err);
    return NextResponse.json({ error: "Failed to extract business information" }, { status: 500 });
  }
}
