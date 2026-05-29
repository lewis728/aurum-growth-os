"use client";
/**
 * src/components/dashboard/DeploymentTracker.tsx
 * 7-step vertical timeline showing live orchestration progress.
 * Mounts when chatStore.activeBlueprintId is set.
 * Uses useOrchestrationStatus SSE hook.
 *
 * CLIENT-SIDE ONLY. Never import Prisma, OpenAI, Twilio, or Retell here.
 */
import { useOrchestrationStatus } from "@/hooks/useOrchestrationStatus";

// ── Step label map ────────────────────────────────────────────────────────────
const STEP_LABELS: Record<string, string> = {
  BUDGET_GUARD:         "Budget authorisation",
  CREATIVE_GENERATED:   "Creative assets generated",
  LANDING_PAGE_LIVE:    "Landing page deployed",
  VOICE_AGENT_READY:    "Voice agent configured",
  META_ADS_LIVE:        "Meta ads activated",
  BLUEPRINT_PERSISTED:  "Campaign saved to database",
  ORCHESTRATION_COMPLETE: "Campaign is live",
};

const STEP_ORDER = [
  "BUDGET_GUARD",
  "CREATIVE_GENERATED",
  "LANDING_PAGE_LIVE",
  "VOICE_AGENT_READY",
  "META_ADS_LIVE",
  "BLUEPRINT_PERSISTED",
  "ORCHESTRATION_COMPLETE",
] as const;

type StepStatus = "pending" | "in_progress" | "complete" | "error";

interface StepState {
  label:  string;
  status: StepStatus;
  error?: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface DeploymentTrackerProps {
  blueprintId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DeploymentTracker({ blueprintId }: DeploymentTrackerProps): JSX.Element {
  const { orchestrationLog, isComplete, isError } = useOrchestrationStatus(blueprintId);

  // Build step states from the orchestration log
  const completedSteps = new Set(
    orchestrationLog
      .filter((e) => e.status === "success")
      .map((e) => e.step)
  );
  const failedSteps = new Map(
    orchestrationLog
      .filter((e) => e.status === "failure")
      .map((e) => [e.step, e.error ?? "Step failed"])
  );

  // Determine which step is currently in progress
  const lastCompleted = STEP_ORDER.filter((s) => completedSteps.has(s));
  const lastCompletedIdx = lastCompleted.length > 0
    ? STEP_ORDER.indexOf(lastCompleted[lastCompleted.length - 1])
    : -1;
  const inProgressIdx = isComplete || isError ? -1 : lastCompletedIdx + 1;

  const steps: StepState[] = STEP_ORDER.map((key, idx) => {
    if (failedSteps.has(key)) {
      return { label: STEP_LABELS[key] ?? key, status: "error", error: failedSteps.get(key) };
    }
    if (completedSteps.has(key)) {
      return { label: STEP_LABELS[key] ?? key, status: "complete" };
    }
    if (idx === inProgressIdx) {
      return { label: STEP_LABELS[key] ?? key, status: "in_progress" };
    }
    return { label: STEP_LABELS[key] ?? key, status: "pending" };
  });

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <h3 className="text-sm font-semibold text-gray-900">
          {isComplete ? "Campaign live" : isError ? "Deployment failed" : "Deploying campaign…"}
        </h3>
      </div>

      {/* Timeline */}
      <ol className="space-y-0">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          return (
            <li key={step.label} className="flex gap-3">
              {/* Connector column */}
              <div className="flex flex-col items-center">
                <StepIcon status={step.status} />
                {!isLast && (
                  <div
                    className={`w-px flex-1 mt-1 mb-1 ${
                      step.status === "complete" ? "bg-amber-200" : "bg-gray-100"
                    }`}
                    style={{ minHeight: "20px" }}
                  />
                )}
              </div>

              {/* Label column */}
              <div className={`pb-4 ${isLast ? "pb-0" : ""}`}>
                <p
                  className={`text-sm leading-5 ${
                    step.status === "complete"
                      ? "text-gray-700 font-medium"
                      : step.status === "in_progress"
                      ? "text-gray-900 font-semibold"
                      : step.status === "error"
                      ? "text-red-600 font-medium"
                      : "text-gray-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.status === "error" && step.error && (
                  <p className="text-xs text-red-500 mt-0.5">{step.error}</p>
                )}
                {step.status === "in_progress" && (
                  <p className="text-xs text-amber-600 mt-0.5">In progress…</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Result banner */}
      {isComplete && (
        <div className="mt-4 flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-green-700">
            Your client campaign is live and accepting leads.
          </p>
        </div>
      )}

      {isError && (
        <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-red-700">
            Deployment failed. Check the error above and try again.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Step icon sub-component ───────────────────────────────────────────────────
function StepIcon({ status }: { status: StepStatus }): JSX.Element {
  if (status === "complete") {
    return (
      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#C9A84C" }}>
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 animate-pulse" style={{ borderColor: "#C9A84C" }}>
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#C9A84C" }} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  // pending
  return (
    <div className="w-5 h-5 rounded-full border-2 border-gray-200 bg-white flex-shrink-0" />
  );
}
