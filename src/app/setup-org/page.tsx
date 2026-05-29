"use client";
/**
 * src/app/setup-org/page.tsx
 *
 * Shown once on first sign-in when the user has no Clerk organisation.
 * Automatically:
 *   1. Calls POST /api/auth/setup-org to create a Clerk org for the user
 *   2. Calls Clerk's setActive() to activate the new org in the session JWT
 *   3. Redirects to /onboarding
 *
 * The user sees a brief loading screen — no manual action required.
 */
import { useEffect, useState } from "react";
import { useOrganization, useOrganizationList, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

export default function SetupOrgPage() {
  const router = useRouter();
  const { user, isLoaded: userLoaded } = useUser();
  const { organization } = useOrganization();
  const { setActive, isLoaded: orgListLoaded } = useOrganizationList();
  const [status, setStatus] = useState<"loading" | "creating" | "activating" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!userLoaded || !orgListLoaded) return;

    // If user already has an active org, go straight to onboarding
    if (organization) {
      router.replace("/onboarding");
      return;
    }

    // If not signed in, go to sign-in
    if (!user) {
      router.replace("/sign-in");
      return;
    }

    async function createAndActivateOrg() {
      try {
        setStatus("creating");

        // Call the server-side route to create the Clerk org
        const res = await fetch("/api/auth/setup-org", {
          method: "POST",
          credentials: "include",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const { orgId } = await res.json();

        setStatus("activating");

        // Activate the new org in the Clerk session so orgId appears in JWT
        if (setActive) {
          await setActive({ organization: orgId });
        }

        setStatus("done");

        // Small delay to let the session token propagate, then go to onboarding
        setTimeout(() => {
          router.replace("/onboarding");
        }, 500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[setup-org]", msg);
        setErrorMsg(msg);
        setStatus("error");
      }
    }

    createAndActivateOrg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoaded, orgListLoaded, organization, user]);

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
              {status === "done" && "Done! Redirecting…"}
            </p>
            <p className="text-xs text-gray-400">This only happens once.</p>
          </>
        )}
      </div>
    </div>
  );
}
