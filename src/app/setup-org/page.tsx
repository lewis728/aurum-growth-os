"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

async function waitForServerOrgId(maxMs = 8000): Promise<boolean> {
  const interval = 400;
  const attempts = Math.ceil(maxMs / interval);
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch("/api/auth/check-session", { credentials: "include" });
      const data = (await res.json()) as { orgId: string | null };
      if (data.orgId) return true;
    } catch {
      // ignore transient errors
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

export default function SetupOrgPage() {
  const { userId, orgId } = useAuth();
  const { isLoaded: orgListLoaded, setActive, userMemberships } =
    useOrganizationList({ userMemberships: { infinite: true } });
  const searchParams = useSearchParams();
  const fromOnboarding = searchParams.get("from") === "onboarding";
  const agencyName = searchParams.get("agencyName") ?? "";

  const [setupDone, setSetupDone] = useState(false);
  const [status, setStatus] = useState("Preparing your workspace…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgListLoaded) return;

    async function setup() {
      try {
        if (fromOnboarding) {
          setStatus("Syncing your session…");
          const memberships = userMemberships?.data ?? [];
          if (memberships.length > 0 && setActive) {
            await setActive({ organization: memberships[0]!.organization.id });
          }
          setStatus("Finalising your workspace…");
          await waitForServerOrgId();
          setSetupDone(true);
          return;
        }

        if (orgId) {
          setSetupDone(true);
          return;
        }

        setStatus("Creating your agency workspace…");
        const res = await fetch("/api/auth/setup-org", { method: "POST" });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Failed to create workspace");
        }
        const data = (await res.json()) as { orgId: string };
        if (setActive) {
          await setActive({ organization: data.orgId });
        }
        await waitForServerOrgId();
        setSetupDone(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.error("[setup-org]", msg);
      }
    }

    void setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgListLoaded]);

  // Always navigate to / when done — layout handles redirecting to /onboarding if needed
  useEffect(() => {
    if (!setupDone) return;
    const dest = fromOnboarding && agencyName
      ? `/?welcome=1&agencyName=${encodeURIComponent(agencyName)}`
      : "/";
    window.location.href = dest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupDone]);

  if (!userId) {
    window.location.href = "/sign-in";
    return null;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center space-y-4 max-w-md px-6">
          <p className="text-red-400 font-medium">Setup failed</p>
          <p className="text-zinc-400 text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="text-center space-y-6">
        <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-zinc-300 text-sm">{status}</p>
      </div>
    </div>
  );
}
