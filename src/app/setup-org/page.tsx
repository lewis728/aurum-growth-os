"use client";
/**
 * src/app/setup-org/page.tsx
 *
 * Shown once on first sign-in when the user has no Clerk organisation.
 *
 * Flow:
 *   1. Call POST /api/auth/setup-org to create the Clerk org server-side
 *   2. Call setActive({ organization: orgId }) to activate it in the session
 *   3. Wait for useAuth().orgId to be populated (Clerk propagates reactively)
 *   4. Only then navigate to /onboarding via window.location.href
 *
 * This prevents the redirect loop where we navigate before the JWT cookie
 * has synced, causing the server to see orgId as null and redirect back here.
 */
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function SetupOrgPage() {
  const { orgId } = useAuth();
  const { setActive, isLoaded: orgListLoaded } = useOrganizationList();
  const [setupDone, setSetupDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "creating" | "activating" | "waiting" | "error">("loading");

  // Step 1: Call setup API and setActive — runs once on mount
  useEffect(() => {
    if (!orgListLoaded) return;

    // If already has an org (e.g. page refresh mid-flow), skip straight to navigate
    if (orgId) {
      window.location.href = "/onboarding";
      return;
    }

    async function setup() {
      try {
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
  }, [orgListLoaded]);

  // Step 2: Navigate only once Clerk has propagated orgId to the client session
  useEffect(() => {
    if (setupDone && orgId) {
      window.location.href = "/onboarding";
    }
  }, [setupDone, orgId]);

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
            <p className="text-xs text-gray-400">This only happens once.</p>
          </>
        )}
      </div>
    </div>
  );
}
