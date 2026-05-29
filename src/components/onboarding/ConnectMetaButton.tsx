"use client";
/**
 * src/components/onboarding/ConnectMetaButton.tsx
 *
 * Renders the Meta account connection button with three states:
 *
 *   1. NOT CONNECTED — Gold "Connect Your Meta Ad Account" button.
 *      Clicking redirects to GET /api/auth/meta which initiates OAuth.
 *
 *   2. CONNECTED — Green checkmark badge + "Meta Connected — [Ad Account ID]".
 *      Clicking does nothing (already connected). Reconnect link available.
 *
 *   3. EXPIRED — Amber warning badge + "Reconnect Meta Account".
 *      Clicking re-initiates the OAuth flow.
 *
 * State is fetched from GET /api/auth/meta/status on mount.
 * URL query params ?meta_connected=true and ?meta_error=<msg> are consumed
 * on mount to show toast feedback after the OAuth redirect.
 *
 * The decrypted access token is NEVER present in any API response consumed
 * by this component.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectionState =
  | { status: "loading" }
  | { status: "not_connected" }
  | { status: "expired"; expiredAt: string }
  | {
      status: "connected";
      adAccountId: string;
      pageId: string;
      pixelId: string;
      tokenExpiresAt: string;
      connectedAt: string;
    };

// ── Status API ────────────────────────────────────────────────────────────────

interface StatusApiResponse {
  connected: boolean;
  reason?: "not_connected" | "expired";
  expiredAt?: string;
  adAccountId?: string;
  pageId?: string;
  pixelId?: string;
  tokenExpiresAt?: string;
  connectedAt?: string;
}

async function fetchConnectionState(): Promise<ConnectionState> {
  const res = await fetch("/api/auth/meta/status", { credentials: "include" });
  if (!res.ok) {
    // Treat fetch errors as not_connected so the button still renders
    return { status: "not_connected" };
  }
  const data = (await res.json()) as StatusApiResponse;

  if (!data.connected) {
    if (data.reason === "expired" && data.expiredAt) {
      return { status: "expired", expiredAt: data.expiredAt };
    }
    return { status: "not_connected" };
  }

  return {
    status: "connected",
    adAccountId: data.adAccountId ?? "",
    pageId: data.pageId ?? "",
    pixelId: data.pixelId ?? "",
    tokenExpiresAt: data.tokenExpiresAt ?? "",
    connectedAt: data.connectedAt ?? "",
  };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

type ToastType = "success" | "error";

interface Toast {
  type: ToastType;
  message: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConnectMetaButton(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<ConnectionState>({ status: "loading" });
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Load connection state ─────────────────────────────────────────────────
  const loadState = useCallback(async () => {
    const next = await fetchConnectionState();
    setState(next);
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // ── Consume OAuth redirect query params ───────────────────────────────────
  useEffect(() => {
    const connected = searchParams.get("meta_connected");
    const error = searchParams.get("meta_error");

    if (connected === "true") {
      showToast("success", "Meta Ad Account connected successfully.");
      void loadState();
      // Clean up query params without a full navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("meta_connected");
      router.replace(url.pathname + url.search);
    }

    if (error) {
      showToast("error", decodeURIComponent(error));
      const url = new URL(window.location.href);
      url.searchParams.delete("meta_error");
      router.replace(url.pathname + url.search);
    }
  }, [searchParams, loadState, showToast, router]);

  // ── OAuth initiation ──────────────────────────────────────────────────────
  const handleConnect = () => {
    window.location.href = "/api/auth/meta";
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative inline-block">
      {/* Toast */}
      {toast && (
        <div
          role="alert"
          className={[
            "absolute -top-12 left-0 right-0 px-4 py-2 rounded-xl text-sm font-medium",
            "shadow-md transition-all duration-300 z-50 text-center",
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200",
          ].join(" ")}
        >
          {toast.message}
        </div>
      )}

      {/* Loading skeleton */}
      {state.status === "loading" && (
        <div className="h-10 w-64 rounded-xl bg-gray-100 animate-pulse" />
      )}

      {/* Not connected */}
      {state.status === "not_connected" && (
        <button
          onClick={handleConnect}
          className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#C9A84C]"
          style={{ backgroundColor: "#C9A84C" }}
          aria-label="Connect your Meta Ad Account"
        >
          {/* Meta logo mark */}
          <MetaIcon className="w-4 h-4 text-white" />
          Connect Your Meta Ad Account
        </button>
      )}

      {/* Connected */}
      {state.status === "connected" && (
        <div className="flex flex-col gap-1">
          <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-green-800 bg-green-50 border border-green-200">
            <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span>
              Meta Connected
              {state.adAccountId && (
                <span className="ml-1 font-normal text-green-600">
                  — {state.adAccountId}
                </span>
              )}
            </span>
          </div>
          <button
            onClick={handleConnect}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 text-left transition-colors"
          >
            Reconnect account
          </button>
        </div>
      )}

      {/* Expired */}
      {state.status === "expired" && (
        <div className="flex flex-col gap-1">
          <button
            onClick={handleConnect}
            className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-300 hover:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-400"
            aria-label="Reconnect your Meta Ad Account — token expired"
          >
            <ExclamationIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
            Reconnect Meta Account
          </button>
          {state.expiredAt && (
            <p className="text-xs text-gray-400 pl-1">
              Token expired{" "}
              {new Date(state.expiredAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Icon Components ───────────────────────────────────────────────────────────

function MetaIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ExclamationIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}
