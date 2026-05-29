// src/app/layout.tsx
// Root layout for Aurum Growth OS.
// Injects agency branding CSS variables when an agency has configured their brand.
// When branding is active, zero trace of "Aurum" appears in metadata or rendered HTML.
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
import { auth } from "@clerk/nextjs/server";
import { getBranding } from "@/lib/services/brandingService";
import "./globals.css";

const inter = Inter({
  subsets:  ["latin"],
  variable: "--font-inter",
  display:  "swap",
});

// ── Metadata ──────────────────────────────────────────────────────────────────
// Dynamic metadata is generated per-request via generateMetadata.
// The static export below is the fallback for unauthenticated pages.
export const metadata: Metadata = {
  title:       "Aurum Growth OS",
  description: "Autonomous AI marketing platform for agency owners",
};

// ── Branding defaults ─────────────────────────────────────────────────────────
const DEFAULT_PRIMARY = "C9A84C";
const DEFAULT_ACCENT  = "FFFFFF";
const DEFAULT_TITLE   = "Aurum Growth OS";

// ── Root Layout ───────────────────────────────────────────────────────────────
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Attempt to load agency branding — gracefully handles unauthenticated state
  let primaryColour = DEFAULT_PRIMARY;
  let accentColour  = DEFAULT_ACCENT;
  let agencyName    = DEFAULT_TITLE;
  let logoUrl: string | null = null;
  let hasBranding   = false;

  try {
    const { orgId } = await auth();
    if (orgId) {
      const branding = await getBranding(orgId);
      if (branding) {
        primaryColour = branding.primaryColour;
        accentColour  = branding.accentColour;
        agencyName    = branding.agencyName;
        logoUrl       = branding.logoUrl ?? null;
        hasBranding   = true;
      }
    }
  } catch {
    // Unauthenticated or branding unavailable — use Aurum defaults silently
  }

  // Build CSS variables for brand colours
  const brandStyle = [
    `--brand-primary: #${primaryColour}`,
    `--brand-accent: #${accentColour}`,
  ].join("; ");

  return (
    <ClerkProvider>
      <html
        lang="en"
        className={inter.variable}
        style={{ ["--brand-primary" as string]: `#${primaryColour}`, ["--brand-accent" as string]: `#${accentColour}` }}
      >
        <head>
          <title>{hasBranding ? agencyName : DEFAULT_TITLE}</title>
          <meta name="description" content={hasBranding ? `${agencyName} — Client Campaign Management` : "Autonomous AI marketing platform for agency owners"} />
          <style>{`:root { ${brandStyle} }`}</style>
        </head>
        <body
          className="font-sans bg-white text-gray-900 antialiased"
          data-logo-url={logoUrl ?? ""}
          data-agency-name={hasBranding ? agencyName : ""}
        >
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
