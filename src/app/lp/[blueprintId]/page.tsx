/**
 * src/app/lp/[blueprintId]/page.tsx
 * Public, client-specific lead-capture landing page (server component).
 * Fetches the blueprint + ClientBrief + agency branding and renders a polished,
 * conversion-focused page with copy drawn from the client's own brief — not
 * generic. The form posts to /api/lp/submit (server-side signed → leads webhook).
 *
 * Public route — no Clerk auth. White-labelled: footer shows the client business
 * name only. Uses the agency's brand colour (dynamic per tenant — a legitimate
 * exception to the dashboard's CSS-variable rule).
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/services/brandingService";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

function hex(c: string | null | undefined, fallback: string): string {
  const v = (c ?? "").replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(v) ? `#${v}` : fallback;
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;\n]+/)
    .map(s => s.replace(/^[-•\d.\s]+/, "").trim())
    .filter(Boolean);
}

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

  const accent     = hex(branding?.primaryColour, "#C9A84C");
  const niceVert   = blueprint.vertical.replace(/[._]/g, " ");
  const headline   = blueprint.offerHook?.trim()
    || `Book your free ${niceVert} consultation with ${blueprint.businessName}`;
  const sub        = brief?.websiteSummary?.trim()
    || blueprint.businessDescription?.trim()
    || `Speak to the team at ${blueprint.businessName} and get expert advice tailored to you — no obligation.`;

  let bullets = splitList(brief?.keyUSPs).slice(0, 3);
  if (bullets.length === 0) {
    bullets = ["Free, no-obligation consultation", "Friendly expert advice", "Fast response — we call you back fast"];
  }

  const questions = splitList(brief?.qualificationQuestions).slice(0, 3);
  const ctaText   = "Get My Free Consultation";

  return (
    <main style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "Inter, system-ui, sans-serif", color: "#111827" }}>
      {/* accent top bar */}
      <div style={{ height: "4px", background: accent }} />

      <div style={{ maxWidth: "1040px", margin: "0 auto", padding: "48px 20px 64px" }}>
        {(branding?.logoUrl || branding?.agencyName) && (
          <div style={{ marginBottom: "36px" }}>
            {branding?.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={branding.logoUrl} alt={blueprint.businessName} style={{ height: "34px", width: "auto" }} />
              : <span style={{ fontSize: "18px", fontWeight: 700 }}>{blueprint.businessName}</span>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "48px", alignItems: "start" }}>
          {/* Left — pitch */}
          <div>
            <h1 style={{ fontSize: "40px", lineHeight: 1.12, fontWeight: 800, margin: "0 0 18px", letterSpacing: "-0.02em" }}>
              {headline}
            </h1>
            <p style={{ fontSize: "18px", lineHeight: 1.55, color: "#4b5563", margin: "0 0 28px" }}>
              {sub}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
              {bullets.map((b, i) => (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", fontSize: "16px", color: "#1f2937" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }} aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Right — form card */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "16px", padding: "28px", boxShadow: "0 10px 40px rgba(0,0,0,0.06)" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px" }}>Request your free consultation</h2>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 20px" }}>Fill this in and we&apos;ll call you straight back.</p>
            <LeadForm blueprintId={blueprint.id} accent={accent} ctaText={ctaText} questions={questions} />
          </div>
        </div>
      </div>

      {/* Footer — client business name only, no platform branding */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "24px 20px", textAlign: "center" }}>
        <span style={{ fontSize: "13px", color: "#9ca3af" }}>
          © {new Date().getFullYear()} {blueprint.businessName}
          {blueprint.targetLocation ? ` · ${blueprint.targetLocation}` : ""}
        </span>
      </footer>
    </main>
  );
}
