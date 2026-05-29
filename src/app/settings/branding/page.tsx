/**
 * src/app/settings/branding/page.tsx
 *
 * Agency White-Label Branding settings page.
 * Server component wrapper — renders BrandingConfig form and ClientOverview table.
 *
 * Route: /settings/branding
 * Auth:  Protected by Clerk middleware (clerkMiddleware in src/middleware.ts).
 */

import { Suspense } from "react";
import BrandingConfig from "@/components/onboarding/BrandingConfig";
import { ClientOverview } from "@/components/dashboard/ClientOverview";

// ── Skeleton loaders ──────────────────────────────────────────────────────────
function FormSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}

function TableSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-8 rounded-lg bg-gray-100" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-lg bg-gray-50" />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BrandingPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-white">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100 bg-white px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ backgroundColor: "#C9A84C1A" }}
            >
              <svg
                className="h-5 w-5"
                style={{ color: "#C9A84C" }}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#111827] tracking-tight">
                Agency Branding
              </h1>
              <p className="text-xs text-[#6B7280]">
                Customise how your agency appears to your clients
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-12">
        {/* Branding configuration form */}
        <section>
          <Suspense fallback={<FormSkeleton />}>
            <BrandingConfig />
          </Suspense>
        </section>

        {/* Divider */}
        <hr className="border-gray-100" />

        {/* Client overview table */}
        <section>
          <div className="mb-5">
            <h2 className="text-base font-bold text-[#111827] tracking-tight">
              Your Clients
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              All active client campaigns managed through your agency account.
            </p>
          </div>
          <Suspense fallback={<TableSkeleton />}>
            <ClientOverview />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
