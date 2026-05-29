/**
 * src/app/(dashboard)/page.tsx
 * Server component wrapper — imports the client dashboard page.
 * This file must remain a server component so Next.js generates
 * the page_client-reference-manifest.js required for standalone output.
 */
import DashboardPageClient from "@/components/dashboard/DashboardPageClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardPageClient />;
}
