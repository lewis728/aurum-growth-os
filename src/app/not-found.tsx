/**
 * src/app/not-found.tsx
 * Next.js 404 page for Aurum Growth OS.
 * Matches the clean white/gold design language.
 */
import Link from "next/link";

export default function NotFound(): JSX.Element {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#C9A84C" }}
          >
            <span className="text-xs font-bold text-white">A</span>
          </div>
          <span className="text-sm font-bold text-gray-900">Aurum Growth OS</span>
        </div>

        {/* 404 */}
        <p
          className="text-7xl font-bold mb-4 tracking-tight"
          style={{ color: "#C9A84C" }}
        >
          404
        </p>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Page not found
        </h1>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 py-2.5 px-6 rounded-xl text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: "#C9A84C" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
