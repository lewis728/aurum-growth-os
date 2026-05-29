"use client";

/**
 * src/components/onboarding/CreativeModeSelector.tsx
 *
 * Shown during campaign setup. The agency owner chooses once:
 *   Mode 1 — Aurum generates creative for the client (Higgsfield flow)
 *   Mode 2 — Agency uploads the client's own brand assets (BYO-Creative flow)
 *
 * Selection is stored in blueprint.creative.mode.
 * Cannot be changed after campaign launch.
 */

import { useState } from "react";
import { Sparkles, Upload, CheckCircle2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreativeMode = "generate" | "upload";

interface CreativeModeSelectorProps {
  /** Called when the agency owner confirms their selection */
  onSelect: (mode: CreativeMode) => void;
  /** Whether the confirm button is in a loading state */
  loading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreativeModeSelector({
  onSelect,
  loading = false,
}: CreativeModeSelectorProps) {
  const [selected, setSelected] = useState<CreativeMode | null>(null);

  const cards: Array<{
    mode: CreativeMode;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    badge?: string;
  }> = [
    {
      mode: "generate",
      icon: <Sparkles className="w-7 h-7" />,
      title: "Generate creative for your client",
      subtitle:
        "We create professional ad creative for your client's campaign from their brief. Recommended for new campaigns.",
      badge: "Recommended",
    },
    {
      mode: "upload",
      icon: <Upload className="w-7 h-7" />,
      title: "Upload your client's creative",
      subtitle:
        "Upload your client's existing brand photos or videos. Full control over their creative.",
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Heading */}
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">
          Choose a creative approach for your client
        </h2>
        <p className="text-sm text-gray-500">
          This sets how ad creative will be produced for this campaign.
          You can change this before launch.
        </p>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(({ mode, icon, title, subtitle, badge }) => {
          const isSelected = selected === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setSelected(mode)}
              className={[
                "relative flex flex-col items-start gap-3 rounded-2xl border-2 p-5 text-left",
                "transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]",
                isSelected
                  ? "border-[#C9A84C] bg-amber-50 shadow-md"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
              ].join(" ")}
            >
              {/* Badge */}
              {badge && (
                <span className="absolute top-3 right-3 rounded-full bg-[#C9A84C] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {badge}
                </span>
              )}

              {/* Icon */}
              <span
                className={[
                  "flex h-11 w-11 items-center justify-center rounded-xl",
                  isSelected
                    ? "bg-[#C9A84C] text-white"
                    : "bg-gray-100 text-gray-500",
                ].join(" ")}
              >
                {icon}
              </span>

              {/* Text */}
              <div className="space-y-1">
                <p className="font-semibold text-gray-900 text-sm leading-snug">
                  {title}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">{subtitle}</p>
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <CheckCircle2 className="absolute bottom-3 right-3 w-5 h-5 text-[#C9A84C]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Confirm button */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={!selected || loading}
          onClick={() => {
            if (selected) onSelect(selected);
          }}
          className={[
            "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold",
            "transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]",
            selected && !loading
              ? "bg-[#C9A84C] text-white hover:bg-[#b8943f] shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving…
            </>
          ) : (
            "Continue"
          )}
        </button>
      </div>
    </div>
  );
}
