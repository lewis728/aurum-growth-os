/**
 * src/app/settings/notifications/page.tsx
 * Agency notification settings — Slack alerting (Sprint 4).
 * Route: /settings/notifications
 */

import { NotificationsConfig } from "@/components/settings/NotificationsConfig";

export const dynamic = "force-dynamic";

export default function NotificationsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-gray-100 bg-white px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-lg font-bold text-[#111827] tracking-tight">Notifications</h1>
          <p className="text-xs text-[#6B7280]">Where your AI team reaches you when something needs a human</p>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <NotificationsConfig />
      </div>
    </div>
  );
}
