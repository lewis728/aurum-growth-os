/**
 * src/app/lp/[blueprintId]/page.tsx
 * Public, homeowner-facing B2C roofing landing page (server component) — the
 * destination for the Meta ad. Mobile-first, single column, form near the top.
 * Copy is blueprint-driven (business name, city, offer hook, brief) with strong
 * roofing defaults. The form posts to /api/lp/submit (server-side signed → leads
 * webhook), which triggers the 60-second Retell call.
 *
 * Public route — no Clerk auth. Uses the brand colour per tenant (a legitimate
 * exception to the dashboard's CSS-variable rule).
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/services/brandingService";
import { LeadForm } from "./LeadForm";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

function hex(c: string | null | undefined, fallback: string): string {
  const v = (c ?? "").replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(v) ? `#${v}` : fallback;
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[;\n]+/).map(s => s.replace(/^[-•\d.\s]+/, "").trim()).filter(Boolean);
}

const STEPS: { title: string; body: string }[] = [
  { title: "Tell us about your roof", body: "30 seconds — your name, number and what's going on up there." },
  { title: "We call you within 60 seconds", body: "A quick chat to understand the job and find a time that suits you." },
  { title: "A local roofer surveys it — free", body: "A vetted roofer comes out, takes a look and gives you a no-obligation quote." },
];

export default async function LandingPage(
  { params }: { params: { blueprintId: string } }
): Promise<JSX.Element> {
  const blueprint = await prisma.campaignBlueprint.findUnique({
    where:  { id: params.blueprintId },
    select: {
      id: true, tenantId: true, businessName: true, vertical: true,
      offerHook: true, businessDescription: true, targetLocation: true,
    },
  });
  if (!blueprint) notFound();

  const [brief, branding] = await Promise.all([
    prisma.clientBrief.findUnique({ where: { blueprintId: blueprint.id } }),
    getBranding(blueprint.tenantId),
  ]);

  const accent   = hex(branding?.primaryColour, "#C9A84C");
  const city     = blueprint.targetLocation?.trim() || "";
  const headline = blueprint.offerHook?.trim()
    || `Free, no-obligation roof survey${city ? ` in ${city}` : ""}`;
  const sub = brief?.websiteSummary?.trim()
    || blueprint.businessDescription?.trim()
    || "Leak, missing tiles, storm damage or thinking about a full re-roof? Tell us what's going on and a vetted local roofer will come and survey it — free, with absolutely no obligation.";

  let bullets = splitList(brief?.keyUSPs).slice(0, 4);
  if (bullets.length === 0) {
    bullets = [
      "Free, no-obligation survey & quote",
      "Local, vetted & insured roofers only",
      "We call you back within 60 seconds",
      "No pushy sales — just an honest look",
    ];
  }

  const card: CSSProperties = {
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px",
    padding: "24px", boxShadow: "0 10px 40px rgba(0,0,0,0.07)",
  };
  const pill: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px",
    borderRadius: "999px", background: "#fff", border: "1px solid #e5e7eb",
    fontSize: "13px", fontWeight: 600, color: "#374151",
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f4f6f8", fontFamily: "Inter, system-ui, sans-serif", color: "#111827" }}>
      <div style={{ height: "4px", background: accent }} />

      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "28px 18px 56px" }}>
        {/* Brand */}
        <div style={{ marginBottom: "22px", textAlign: "center" }}>
          {branding?.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={branding.logoUrl} alt={blueprint.businessName} style={{ height: "34px", width: "auto" }} />
            : <span style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.01em" }}>{blueprint.businessName}</span>}
        </div>

        {/* Hero */}
        {city && (
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <span style={{ ...pill, background: `${accent}1a`, border: `1px solid ${accent}55`, color: "#1f2937" }}>
              📍 {city} homeowners
            </span>
          </div>
        )}
        <h1 style={{ fontSize: "32px", lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 14px" }}>
          {headline}
        </h1>
        <p style={{ fontSize: "17px", lineHeight: 1.55, color: "#4b5563", textAlign: "center", margin: "0 0 20px" }}>
          {sub}
        </p>

        {/* Trust strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginBottom: "24px" }}>
          <span style={pill}><span style={{ color: "#f59e0b" }}>★★★★★</span> Trusted locally</span>
          <span style={pill}>✓ Vetted &amp; insured</span>
          <span style={pill}>✓ No obligation</span>
        </div>

        {/* Form — the conversion point */}
        <div style={card}>
          <h2 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 4px", textAlign: "center" }}>Book your free roof survey</h2>
          <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 18px", textAlign: "center" }}>
            Fill this in and we&apos;ll call you straight back.
          </p>
          <LeadForm blueprintId={blueprint.id} accent={accent} ctaText="Get My Free Roof Survey" />
        </div>

        {/* How it works */}
        <h3 style={{ fontSize: "16px", fontWeight: 700, textAlign: "center", margin: "40px 0 18px", color: "#374151" }}>
          How it works
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ ...card, padding: "16px 18px", display: "flex", gap: "14px", alignItems: "flex-start", boxShadow: "none" }}>
              <div style={{
                flexShrink: 0, width: "30px", height: "30px", borderRadius: "999px",
                background: accent, color: "#fff", fontWeight: 800, fontSize: "15px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "2px" }}>{s.title}</div>
                <div style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.5 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Why us */}
        <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", display: "flex", flexDirection: "column", gap: "12px" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "11px", fontSize: "15px", color: "#1f2937" }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }} aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {b}
            </li>
          ))}
        </ul>
      </div>

      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "22px 20px", textAlign: "center" }}>
        <span style={{ fontSize: "13px", color: "#9ca3af" }}>
          © {new Date().getFullYear()} {blueprint.businessName}{city ? ` · ${city}` : ""}
        </span>
      </footer>
    </main>
  );
}
