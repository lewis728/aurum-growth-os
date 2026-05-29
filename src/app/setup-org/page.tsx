"use client";

import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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

  // ── Effect 1: Create or re-activate org ──────────────────────────────────
  useEffect(() => {
    if (!orgListLoaded) return;

    // If orgId is already set, skip setup
    if (orgId) {
      setSetupDone(true);
      return;
    }

    async function setup() {
      try {
        if (fromOnboarding) {
          // Post-onboarding: re-activate the existing org (already created)
          setStatus("Syncing your session…");
          const memberships = userMemberships?.data ?? [];
          if (memberships.length > 0 && setActive) {
            await setActive({ organization: memberships[0]!.organization.id });
          }
          setSetupDone(true);
          return;
        }

        // First sign-in: create the org
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

  // ── Effect 2: Navigate once orgId is confirmed in useAuth ─────────────────
  useEffect(() => {
    if (!setupDone || !orgId) return;

    async function finalize() {
      if (fromOnboarding) {
        // Link any pending AgencyProfile to the real orgId
        setStatus("Finalising your profile…");
        try {
          await fetch("/api/auth/link-org", { method: "POST" });
        } catch {
          // Non-fatal — profile will be linked on next request
        }
        const dest = agencyName
          ? `/?welcome=1&agencyName=${encodeURIComponent(agencyName)}`
          : "/?welcome=1";
        window.location.href = dest;
      } else {
        window.location.href = "/onboarding";
      }
    }

    void finalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupDone, orgId]);

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
