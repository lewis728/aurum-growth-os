/**
 * src/app/(marketing)/layout.tsx
 * Layout for the public marketing site (Sprint 16). Nests inside the root layout
 * (html/body/fonts/ClerkProvider already provided there). This group is fully
 * public — clerkMiddleware() does not protect routes unless auth.protect() is
 * called, so no middleware change is needed.
 *
 * Forces the dark theme regardless of any stored preference — the marketing site
 * is always premium-dark.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "Aurum — Your agency. Fully staffed by AI.",
  description:
    "Aurum gives every agency owner a team of AI staff — one per client — that manage Meta ads, call leads within 60 seconds, book appointments, and report back every morning.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" style={{ background: "var(--bg)", color: "var(--text-1)", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
