/**
 * src/app/api/admin/verticals/seed/route.ts
 * POST /api/admin/verticals/seed
 * SERVER-SIDE ONLY.
 *
 * Admin-protected route that triggers seeding of all 20 initial vertical profiles.
 * Protected by ADMIN_SECRET header — never exposed to end users.
 *
 * This route is idempotent — running it multiple times is safe.
 * Existing profiles are NOT overwritten (upsert skips update if already present).
 *
 * Usage:
 *   curl -X POST https://your-domain.com/api/admin/verticals/seed \
 *     -H "x-admin-secret: <ADMIN_SECRET>"
 *
 * Returns:
 *   { seeded: number, skipped: number, failed: number, results: SeedResult[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateVerticalProfile, getVerticalProfile } from "@/lib/services/verticalLibraryService";
import { ServiceVertical } from "@/enums/campaignEnums";

export const dynamic = "force-dynamic";

// ── Verticals to Seed ─────────────────────────────────────────────────────────

interface SeedTarget {
  vertical: string;
  businessType: string;
}

const SEED_TARGETS: SeedTarget[] = [
  // ── ServiceVertical enum members ──────────────────────────────────────────
  {
    vertical: ServiceVertical.LAW_PERSONAL_INJURY,
    businessType: "personal injury law firm in the UK",
  },
  {
    vertical: ServiceVertical.LAW_FAMILY,
    businessType: "family law solicitors in the UK",
  },
  {
    vertical: ServiceVertical.LAW_CRIMINAL,
    businessType: "criminal defence solicitors in the UK",
  },
  {
    vertical: ServiceVertical.AESTHETICS_FILLER,
    businessType: "aesthetics clinic specialising in anti-wrinkle injections and dermal fillers in the UK",
  },
  {
    vertical: ServiceVertical.AESTHETICS_LASER,
    businessType: "aesthetics clinic specialising in laser hair removal in the UK",
  },
  {
    vertical: ServiceVertical.DENTAL_IMPLANTS,
    businessType: "dental practice specialising in dental implants in the UK",
  },
  {
    vertical: ServiceVertical.DENTAL_WHITENING,
    businessType: "dental practice offering teeth whitening and cosmetic dentistry in the UK",
  },
  {
    vertical: ServiceVertical.HVAC_INSTALLATION,
    businessType: "HVAC installation company for residential and commercial properties in the UK",
  },
  {
    vertical: ServiceVertical.HVAC_REPAIR,
    businessType: "HVAC repair and maintenance company in the UK",
  },
  {
    vertical: ServiceVertical.ROOFING_RESIDENTIAL,
    businessType: "residential roofing contractor in the UK",
  },
  // ── Additional verticals from spec (GENERAL_ prefix) ─────────────────────
  {
    vertical: "GENERAL_FITNESS_PT",
    businessType: "personal trainer offering 1-to-1 and online fitness coaching in the UK",
  },
  {
    vertical: "GENERAL_FITNESS_GYM",
    businessType: "independent gym or fitness studio in the UK",
  },
  {
    vertical: "GENERAL_REAL_ESTATE_BUYER",
    businessType: "estate agent helping buyers find and purchase property in the UK",
  },
  {
    vertical: "GENERAL_REAL_ESTATE_SELLER",
    businessType: "estate agent helping homeowners sell their property in the UK",
  },
  {
    vertical: "GENERAL_DENTAL_COSMETIC",
    businessType: "cosmetic dental practice offering veneers, composite bonding, and smile makeovers in the UK",
  },
  {
    vertical: "GENERAL_DENTAL_GENERAL",
    businessType: "general dental practice accepting NHS and private patients in the UK",
  },
  {
    vertical: "GENERAL_BAKERY",
    businessType: "artisan bakery or cake shop in the UK",
  },
  {
    vertical: "GENERAL_PLUMBER",
    businessType: "plumbing and heating engineer for residential properties in the UK",
  },
  {
    vertical: "GENERAL_ACCOUNTANT",
    businessType: "chartered accountant offering tax returns, bookkeeping, and business accounts in the UK",
  },
  {
    vertical: "GENERAL_WEDDING_PHOTOGRAPHER",
    businessType: "wedding photographer in the UK",
  },
];


// ── Seed Result Type ──────────────────────────────────────────────────────────

interface SeedResult {
  vertical: string;
  status: "seeded" | "skipped" | "failed";
  error?: string;
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Admin secret check ────────────────────────────────────────────────────
  const adminSecret = req.headers.get("x-admin-secret");
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "ADMIN_SECRET environment variable is not configured." },
      { status: 500 }
    );
  }

  if (!adminSecret || adminSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Seed all 20 verticals ─────────────────────────────────────────────────
  const results: SeedResult[] = [];
  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of SEED_TARGETS) {
    try {
      // Check if already exists
      const existing = await getVerticalProfile(target.vertical);
      if (existing) {
        results.push({ vertical: target.vertical, status: "skipped" });
        skipped++;
        continue;
      }

      // Generate and save
      await generateVerticalProfile(target.businessType, target.vertical);
      results.push({ vertical: target.vertical, status: "seeded" });
      seeded++;

      // Small delay between GPT calls to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ vertical: target.vertical, status: "failed", error: errorMsg });
      failed++;
      console.error(`[seed] Failed to generate profile for ${target.vertical}: ${errorMsg}`);
    }
  }

  return NextResponse.json({
    seeded,
    skipped,
    failed,
    total: SEED_TARGETS.length,
    results,
  });
}
