"use client";

/**
 * src/components/onboarding/RepresentativeSetup.tsx
 *
 * 4-step wizard for configuring a client campaign's AI representative.
 * Agency-owner framing throughout — "your client's representative".
 *
 * Props:
 *   blueprintId        — The campaign blueprint to configure
 *   clientBusinessName — Display name of the client's business
 *   onComplete         — Called after successful save (receives saved representative)
 *   initialValues      — Pre-fill for edit mode
 */

import React, { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Personality = "PROFESSIONAL" | "WARM" | "DIRECT" | "CONSULTATIVE";

interface RepresentativeValues {
  repName:                  string;
  personality:              Personality;
  customIntroLine:          string;
  customObjectionResponses: Record<string, string>;
  voiceId:                  string;
}

interface RepresentativeSetupProps {
  blueprintId:        string;
  clientBusinessName: string;
  onComplete?:        (rep: RepresentativeValues) => void;
  initialValues?:     Partial<RepresentativeValues>;
}

// ── Personality config ────────────────────────────────────────────────────────

const PERSONALITIES: Array<{
  value:       Personality;
  label:       string;
  description: string;
  suitedFor:   string;
  example:     string;
  color:       string;
}> = [
  {
    value:       "PROFESSIONAL",
    label:       "Professional",
    description: "Formal, precise, authoritative — suited to law, finance, B2B.",
    suitedFor:   "Law, Finance, B2B",
    example:     '"Good afternoon. I\'m calling regarding your recent enquiry..."',
    color:       "border-yellow-500 bg-yellow-50",
  },
  {
    value:       "WARM",
    label:       "Warm",
    description: "Empathetic, reassuring, conversational — suited to healthcare, dental, wellness.",
    suitedFor:   "Healthcare, Dental, Wellness",
    example:     '"Hi there! I just wanted to reach out because you showed interest..."',
    color:       "border-blue-400 bg-blue-50",
  },
  {
    value:       "DIRECT",
    label:       "Direct",
    description: "Efficient, outcome-focused — suited to trades, urgent services.",
    suitedFor:   "Trades, Urgent Services",
    example:     '"Hi, calling from [business] — quick question about your enquiry..."',
    color:       "border-green-500 bg-green-50",
  },
  {
    value:       "CONSULTATIVE",
    label:       "Consultative",
    description: "Advisory, question-led — suited to real estate, financial services.",
    suitedFor:   "Real Estate, Financial Services",
    example:     '"I wanted to learn a bit more about what you\'re looking for..."',
    color:       "border-purple-500 bg-purple-50",
  },
];

const EXAMPLE_NAMES = ["Sarah", "James", "Emma", "Marcus", "Alex"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepresentativeSetup({
  blueprintId,
  clientBusinessName,
  onComplete,
  initialValues,
}: RepresentativeSetupProps) {
  const [step, setStep]     = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const [repName, setRepName]               = useState(initialValues?.repName ?? "");
  const [personality, setPersonality]       = useState<Personality>(initialValues?.personality ?? "PROFESSIONAL");
  const [customIntroLine, setCustomIntroLine] = useState(initialValues?.customIntroLine ?? "");

  // ── Derived preview line ──────────────────────────────────────────────────
  const previewLine = customIntroLine.trim()
    ? customIntroLine.trim()
    : `"Hi, is this [leadName]? Great — my name is ${repName || "[name]"}, I'm calling from ${clientBusinessName} regarding your recent enquiry."`;

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/representative", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId,
          repName:         repName.trim() || "Your assistant",
          personality,
          customIntroLine: customIntroLine.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const saved = await res.json() as RepresentativeValues;
      onComplete?.(saved);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                s < step
                  ? "bg-yellow-500 text-white"
                  : s === step
                  ? "bg-yellow-500 text-white ring-2 ring-yellow-300"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {s < step ? "✓" : s}
            </div>
            {s < 4 && <div className={`h-0.5 w-8 ${s < step ? "bg-yellow-500" : "bg-gray-200"}`} />}
          </div>
        ))}
      </div>

      {/* ── Step 1 — Name ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              What would you like your client&apos;s representative to be called?
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              This is the name {clientBusinessName}&apos;s leads will hear on every call.
            </p>
          </div>

          <input
            type="text"
            value={repName}
            onChange={(e) => setRepName(e.target.value)}
            placeholder="e.g. Emma"
            maxLength={80}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_NAMES.map((name) => (
              <button
                key={name}
                onClick={() => setRepName(name)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  repName === name
                    ? "border-yellow-500 bg-yellow-50 text-yellow-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-yellow-400"
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!repName.trim()}
            className="w-full py-3 rounded-lg bg-yellow-500 text-white font-semibold disabled:opacity-40 hover:bg-yellow-600 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Step 2 — Personality ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              How should {repName} come across to {clientBusinessName}&apos;s leads?
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Choose the style that best fits your client&apos;s industry and audience.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {PERSONALITIES.map((p) => (
              <button
                key={p.value}
                onClick={() => setPersonality(p.value)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  personality === p.value
                    ? p.color + " border-opacity-100"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{p.label}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{p.description}</div>
                    <div className="text-xs text-gray-400 mt-1 italic">{p.example}</div>
                  </div>
                  {personality === p.value && (
                    <div className="ml-3 mt-0.5 text-yellow-500 font-bold text-lg">✓</div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-3 rounded-lg bg-yellow-500 text-white font-semibold hover:bg-yellow-600 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 — Preview ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              This is how {repName} will introduce themselves to every lead:
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              You can customise the opening line or leave it as generated.
            </p>
          </div>

          {/* Speech bubble preview */}
          <div className="relative bg-gray-50 border border-gray-200 rounded-2xl p-5">
            <div className="absolute -top-2 left-6 w-4 h-4 bg-gray-50 border-l border-t border-gray-200 rotate-45" />
            <p className="text-gray-800 text-base leading-relaxed italic">{previewLine}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Custom opening line <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={customIntroLine}
              onChange={(e) => setCustomIntroLine(e.target.value)}
              placeholder={`Leave blank to use the generated line above`}
              rows={3}
              maxLength={500}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-lg bg-yellow-500 text-white font-semibold hover:bg-yellow-600 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save & Continue"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>
      )}

      {/* ── Step 4 — Confirm ── */}
      {step === 4 && (
        <div className="space-y-4 text-center">
          <div className="text-5xl">🎉</div>
          <h2 className="text-xl font-semibold text-gray-900">
            {repName} is ready.
          </h2>
          <p className="text-gray-600">
            They will begin calling {clientBusinessName}&apos;s leads automatically when this campaign goes live.
          </p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-left space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Name:</span>
              <span className="text-sm text-gray-900">{repName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Style:</span>
              <span className="text-sm text-gray-900">
                {PERSONALITIES.find((p) => p.value === personality)?.label}
              </span>
            </div>
          </div>

          <button
            onClick={() => onComplete?.({
              repName,
              personality,
              customIntroLine,
              customObjectionResponses: {},
              voiceId: "",
            })}
            className="w-full py-3 rounded-lg bg-yellow-500 text-white font-semibold hover:bg-yellow-600 transition-colors"
          >
            Launch Campaign
          </button>
        </div>
      )}
    </div>
  );
}
