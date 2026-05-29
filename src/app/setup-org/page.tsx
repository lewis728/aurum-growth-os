"use client";
/**
 * src/app/setup-org/page.tsx
 *
 * Shown in two scenarios:
 *   A) First sign-in: user has no Clerk organisation yet
 *      → creates org, activates it, redirects to /onboarding
 *
 *   B) Post-onboarding: user arrives via /setup-org?from=onboarding
 *      → org already exists, just needs a fresh JWT before hitting the dashboard
 *      → skips org creation, calls setActive() with existing orgId, redirects to /
 *
 * Both paths wait for useAuth().orgId to be populated before navigating,
 * ensuring the JWT cookie contains orgId before any server-side check runs.
 */
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function SetupOrgPage() {
  const { orgId } = useAuth();
  const { setActive, isLoaded: orgListLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [setupDone, setSetupDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "creating" | "activating" | "waiting" | "error">("loading");

  // Read query params client-side
  const [fromOnboarding, setFromOnboarding] = useState(false);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFromOnboarding(params.get("from") === "onboarding");
    setBlueprintId(params.get("blueprintId") ?? null);
  }, []);

  // Determine final redirect destination
  const redirectTo = fromOnboarding ? "/" : "/onboarding";
  const redirectWithParams =
    fromOnboarding && blueprintId
      ? `/?onboarded=true&blueprintId=${blueprintId}`
      : redirectTo;

  // Step 1: Call setup API (or re-activate existing org) — runs once on mount
  useEffect(() => {
    if (!orgListLoaded) return;

    // If already has an org in the JWT, navigate directly
    if (orgId) {
      window.location.href = redirectWithParams;
      return;
    }

    async function setup() {
      try {
        // Scenario B: arrived from onboarding — org already exists, just activate it
        if (fromOnboarding) {
          setStatus("activating");
          // Find the first membership and activate it
          const firstMembership = userMemberships?.data?.[0];
          if (firstMembership && setActive) {
            await setActive({ organization: firstMembership.organization.id });
          }
          setStatus("waiting");
          setSetupDone(true);
          return;
        }

        // Scenario A: first sign-in — create a new org
        setStatus("creating");

        const res = await fetch("/api/auth/setup-org", {
          method: "POST",
          credentials: "include",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as { orgId: string };

        setStatus("activating");

        if (setActive) {
          await setActive({ organization: data.orgId });
        }

        // Mark setup complete — Step 2 effect will watch for orgId to populate
        setStatus("waiting");
        setSetupDone(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[setup-org]", msg);
        setErrorMsg(msg);
        setStatus("error");
      }
    }

    setup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgListLoaded, fromOnboarding]);

  // Step 2: Navigate only once Clerk has propagated orgId to the client session
  useEffect(() => {
    if (setupDone && orgId) {
      window.location.href = redirectWithParams;
    }
  }, [setupDone, orgId, redirectWithParams]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        {/* Aurum logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#C9A84C" }}
          >
            <span className="text-sm font-bold text-white">A</span>
          </div>
          <span className="text-base font-bold text-gray-900">Aurum Growth OS</span>
        </div>

        {status === "error" ? (
          <>
            <p className="text-red-600 text-sm mb-4">Setup failed: {errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ backgroundColor: "#C9A84C" }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            {/* Spinner */}
            <div className="flex justify-center mb-6">
              <div
                className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "#C9A84C", borderTopColor: "transparent" }}
              />
            </div>
            <p className="text-sm font-medium text-gray-900 mb-1">
              {status === "loading" && "Preparing your workspace…"}
              {status === "creating" && "Creating your agency workspace…"}
              {status === "activating" && "Activating your workspace…"}
              {status === "waiting" && "Syncing session…"}
            </p>
            <p className="text-xs text-gray-400">
              {fromOnboarding ? "Almost there…" : "This only happens once."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
