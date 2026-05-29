"use client";
/**
 * src/app/error.tsx
 * Next.js Error Boundary for the entire application.
 * Catches unhandled errors during rendering and shows a clean recovery screen.
 * Never exposes stack traces or error details in production.
 */
import { useEffect } from "react";

interface ErrorProps {
  error:  Error & { digest?: string };
  reset:  () => void;
}

export default function GlobalError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    // Log to an error reporting service in production
    // In Phase 1 we log to console; Phase 2 will wire Sentry/Datadog
    if (process.env.NODE_ENV === "production") {
      console.error("[GlobalError] Unhandled error:", error.digest ?? "no-digest");
    } else {
      console.error("[GlobalError]", error);
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        {/* Icon */}
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
          <svg
            className="w-6 h-6 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#C9A84C" }}
          >
            <span className="text-xs font-bold text-white">A</span>
          </div>
          <span className="text-sm font-bold text-gray-900">Aurum Growth OS</span>
        </div>

        {/* Message */}
        <h1 className="text-lg font-semibold text-gray-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Our team has been notified. This is usually a temporary issue — refreshing
          the page resolves it in most cases.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "#C9A84C" }}
          >
            Try again
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
          >
            Return to dashboard
          </button>
        </div>

        {/* Error digest for support reference — never the full stack */}
        {error.digest && (
          <p className="text-xs text-gray-300 mt-6 font-mono">
            Ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
