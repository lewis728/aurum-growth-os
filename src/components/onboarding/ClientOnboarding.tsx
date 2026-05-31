/**
 * src/components/onboarding/ClientOnboarding.tsx
 * Premium multi-step client brief, shown right after Deploy Sophie.
 * Feels like briefing a senior account manager — six short steps, ~8 minutes.
 * Saves to PUT /api/clients/[blueprintId]/brief (every field maps to ClientBrief).
 *
 * Designed for aesthetics clinics but works for any vertical. Dark, premium.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";

interface ObjectionPair { objection: string; response: string }

interface OnboardingState {
  treatments:             string;
  offer:                  string;
  idealCustomerProfile:   string;
  badLeadSignals:         string;
  averageClientValue:     string;
  keyUSPs:                string;
  brandTone:              string;
  competitorNames:        string;
  qualificationQuestions: string;
  objections:             ObjectionPair[];
  budgetHardLimit:        string;
  targetCplGbp:           string;
  approvalThreshold:      string;
  complianceNotes:        string;
  reportingPreferences:   string;
  clientContactName:      string;
  clientContactEmail:     string;
  clientWhatsApp:         string;
}

const INITIAL: OnboardingState = {
  treatments: "", offer: "", idealCustomerProfile: "", badLeadSignals: "",
  averageClientValue: "", keyUSPs: "", brandTone: "", competitorNames: "",
  qualificationQuestions: "", objections: [{ objection: "", response: "" }],
  budgetHardLimit: "", targetCplGbp: "", approvalThreshold: "25",
  complianceNotes: "", reportingPreferences: "", clientContactName: "",
  clientContactEmail: "", clientWhatsApp: "",
};

const TONE_OPTIONS = [
  "Warm & reassuring", "Premium & clinical", "Friendly & approachable",
  "Confident & expert", "Calm & professional",
];
const REPORTING_OPTIONS = [
  "Weekly WhatsApp + monthly email report",
  "Monthly email report only",
  "Weekly email summary",
  "Only contact me when something needs attention",
];

const TOTAL_STEPS = 6;

// ── Shared styles ───────────────────────────────────────────────────────────────
const input: CSSProperties = {
  width: "100%", background: "#000", border: "1px solid #1a1a1a", borderRadius: "10px",
  padding: "12px 14px", fontSize: "14px", color: "#fff", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box",
};
const labelStyle: CSSProperties = { fontSize: "13px", color: "#d4d4d8", marginBottom: "7px", display: "block", fontWeight: 500 };
const hintStyle: CSSProperties  = { fontSize: "12px", color: "#52525b", marginTop: "5px" };

// ── Hoisted field components (stable identity → inputs keep focus) ───────────────
function Field({ label, hint, value, onChange, placeholder, rows = 3, optional }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; rows?: number; optional?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}{optional && <span style={{ color: "#52525b", fontWeight: 400 }}> · optional</span>}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{ ...input, resize: "vertical" }} />
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}
function Line({ label, hint, value, onChange, placeholder, optional, type = "text" }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; optional?: boolean; type?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}{optional && <span style={{ color: "#52525b", fontWeight: 400 }}> · optional</span>}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={input} />
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

export function ClientOnboarding({
  blueprintId, agentName, businessName,
}: { blueprintId: string; agentName: string; businessName: string }) {
  const router = useRouter();
  const [step, setStep]   = useState(1);
  const [form, setForm]   = useState<OnboardingState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof OnboardingState>(k: K) => (v: OnboardingState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setError(null);
  };

  const setObjection = (i: number, key: keyof ObjectionPair, v: string) =>
    setForm(f => ({ ...f, objections: f.objections.map((o, idx) => idx === i ? { ...o, [key]: v } : o) }));
  const addObjection = () => setForm(f => ({ ...f, objections: [...f.objections, { objection: "", response: "" }] }));

  // Required fields per step — gate "Continue".
  const stepValid = (s: number): boolean => {
    switch (s) {
      case 1: return form.treatments.trim() !== "" && form.offer.trim() !== "";
      case 2: return form.idealCustomerProfile.trim() !== "" && form.averageClientValue.trim() !== "";
      case 3: return form.keyUSPs.trim() !== "" && form.brandTone.trim() !== "";
      case 4: return form.qualificationQuestions.trim() !== "";
      case 5: return form.budgetHardLimit.trim() !== "";
      case 6: return form.complianceNotes.trim() !== "" && form.clientContactName.trim() !== "" && form.clientContactEmail.trim() !== "";
      default: return true;
    }
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const websiteSummary = [
        form.treatments.trim() && `Treatments: ${form.treatments.trim()}`,
        form.offer.trim() && `Offer: ${form.offer.trim()}`,
      ].filter(Boolean).join(". ");

      const objectionResponses = form.objections
        .filter(o => o.objection.trim() && o.response.trim())
        .map(o => ({ objection: o.objection.trim(), response: o.response.trim() }));

      const res = await fetch(`/api/clients/${blueprintId}/brief`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          websiteSummary,
          idealCustomerProfile: form.idealCustomerProfile,
          badLeadSignals:       form.badLeadSignals,
          averageClientValue:   form.averageClientValue,
          keyUSPs:              form.keyUSPs,
          brandTone:            form.brandTone,
          competitorNames:      form.competitorNames,
          qualificationQuestions: form.qualificationQuestions,
          objectionResponses,
          budgetHardLimit:      form.budgetHardLimit,
          targetCplGbp:         form.targetCplGbp,
          approvalThreshold:    form.approvalThreshold,
          complianceNotes:      form.complianceNotes,
          reportingPreferences: form.reportingPreferences,
          clientContactName:    form.clientContactName,
          clientContactEmail:   form.clientContactEmail,
          clientWhatsApp:       form.clientWhatsApp,
        }),
      });
      if (!res.ok) { setError("Couldn't save the brief. Please try again."); setSaving(false); return; }
      router.push("/");
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  };

  const next = () => { if (stepValid(step)) setStep(s => Math.min(TOTAL_STEPS, s + 1)); };
  const back = () => setStep(s => Math.max(1, s - 1));

  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: "100%", maxWidth: "620px" }}>
        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#C9A84C", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#000", fontSize: "13px" }}>
              {agentName.charAt(0).toUpperCase()}
            </div>
            <div style={{ fontSize: "13px", color: "#71717a" }}>
              {agentName} is now live for <span style={{ color: "#fff" }}>{businessName}</span>
            </div>
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            Brief {agentName} on this client
          </h1>
          <p style={{ fontSize: "14px", color: "#71717a", margin: 0, lineHeight: 1.5 }}>
            A few minutes now and {agentName} will manage the ads, call leads, and report back exactly the way you would. The more you give her, the sharper she is.
          </p>
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "28px" }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
            <div key={n} style={{ flex: 1, height: "3px", borderRadius: "2px", background: n < step ? "#22c55e" : n === step ? "#C9A84C" : "#1a1a1a", transition: "background 0.2s" }} />
          ))}
        </div>

        {/* Step body */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px", minHeight: "300px" }}>
          {step === 1 && <>
            <StepHeading n={1} title="Your clinic & treatments" />
            <Field label="Which treatments do you most want new patients for?" value={form.treatments} onChange={set("treatments")} placeholder="e.g. anti-wrinkle, dermal fillers, skin boosters, laser hair removal" hint="What should the ads promote?" />
            <Line label="What's the main offer we should advertise?" value={form.offer} onChange={set("offer")} placeholder='e.g. "Free consultation + £50 off your first treatment"' />
          </>}

          {step === 2 && <>
            <StepHeading n={2} title="Your ideal patient" />
            <Field label="Describe your ideal patient" value={form.idealCustomerProfile} onChange={set("idealCustomerProfile")} placeholder="Age, area, what they want, what worries them" />
            <Field label="Who is NOT a good fit?" value={form.badLeadSignals} onChange={set("badLeadSignals")} placeholder="So Sophie doesn't waste budget chasing them — e.g. out of area, bargain-hunters, under 25" optional rows={2} />
            <Line label="Average lifetime value of a patient (£)" type="number" value={form.averageClientValue} onChange={set("averageClientValue")} placeholder="e.g. 800" hint="Lets Sophie think in ROI, not just cost per lead." />
          </>}

          {step === 3 && <>
            <StepHeading n={3} title="Why you" />
            <Field label="Why should someone choose you over another clinic?" value={form.keyUSPs} onChange={set("keyUSPs")} placeholder="Your top 3 — e.g. nurse prescribers, natural results, 12 years' experience" />
            <div>
              <label style={labelStyle}>How should {agentName} sound?</label>
              <select value={form.brandTone} onChange={e => set("brandTone")(e.target.value)} style={{ ...input, cursor: "pointer" }}>
                <option value="">Choose a tone…</option>
                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Line label="Main competitors locally" value={form.competitorNames} onChange={set("competitorNames")} placeholder="Other clinics a patient might consider" optional />
          </>}

          {step === 4 && <>
            <StepHeading n={4} title="Qualifying & objections" />
            <Field label={`What should ${agentName} ask to know a lead is serious?`} value={form.qualificationQuestions} onChange={set("qualificationQuestions")} placeholder="e.g. Which treatment are you interested in? Have you had it before? When are you looking to book?" />
            <div>
              <label style={labelStyle}>Objection playbook <span style={{ color: "#52525b", fontWeight: 400 }}>· optional</span></label>
              <div style={hintStyle}>Common objection → your best response. {agentName} will use these on the call.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                {form.objections.map((o, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <input value={o.objection} onChange={e => setObjection(i, "objection", e.target.value)} placeholder='"It\'s too expensive"' style={input} />
                    <input value={o.response} onChange={e => setObjection(i, "response", e.target.value)} placeholder="Your best response" style={input} />
                  </div>
                ))}
              </div>
              <button onClick={addObjection} style={{ marginTop: "10px", fontSize: "12px", color: "#C9A84C", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                + Add another objection
              </button>
            </div>
          </>}

          {step === 5 && <>
            <StepHeading n={5} title="Budget & guardrails" />
            <Line label="Max daily ad spend (£/day)" type="number" value={form.budgetHardLimit} onChange={set("budgetHardLimit")} placeholder="e.g. 50" hint={`${agentName} will never scale above this without your approval.`} />
            <Line label="Target cost per lead (£)" type="number" value={form.targetCplGbp} onChange={set("targetCplGbp")} placeholder="e.g. 25 — leave blank if unsure" optional />
            <Line label="Auto-approve spend changes under (£)" type="number" value={form.approvalThreshold} onChange={set("approvalThreshold")} placeholder="25" hint="Bigger changes get flagged for your sign-off first." optional />
          </>}

          {step === 6 && <>
            <StepHeading n={6} title="Compliance & how to reach you" />
            <Field label="Anything you legally can't claim or say?" value={form.complianceNotes} onChange={set("complianceNotes")} placeholder="Critical for aesthetics — e.g. no guaranteed results, no before/after of named patients, no medical claims" hint="Sophie applies this to every ad and every call." />
            <div>
              <label style={labelStyle}>How &amp; how often do you want updates? <span style={{ color: "#52525b", fontWeight: 400 }}>· optional</span></label>
              <select value={form.reportingPreferences} onChange={e => set("reportingPreferences")(e.target.value)} style={{ ...input, cursor: "pointer" }}>
                <option value="">Choose…</option>
                {REPORTING_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Line label="Contact name" value={form.clientContactName} onChange={set("clientContactName")} placeholder="Jane Smith" />
              <Line label="Contact email" type="email" value={form.clientContactEmail} onChange={set("clientContactEmail")} placeholder="jane@clinic.com" />
            </div>
            <Line label="WhatsApp number" value={form.clientWhatsApp} onChange={set("clientWhatsApp")} placeholder="+44…" optional hint="For weekly updates from Sophie." />
          </>}
        </div>

        {error && <div style={{ fontSize: "13px", color: "#ef4444", marginTop: "16px" }}>{error}</div>}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "28px", paddingTop: "20px", borderTop: "1px solid #1a1a1a" }}>
          <div>
            {step > 1 && (
              <button onClick={back} style={{ fontSize: "13px", color: "#71717a", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <button onClick={() => router.push("/")} style={{ fontSize: "13px", color: "#52525b", background: "none", border: "none", cursor: "pointer" }}>
              Finish later
            </button>
            {step < TOTAL_STEPS ? (
              <button onClick={next} disabled={!stepValid(step)}
                style={{ background: stepValid(step) ? "#fff" : "#27272a", color: stepValid(step) ? "#000" : "#52525b", fontWeight: 600, fontSize: "14px", padding: "11px 24px", borderRadius: "10px", border: "none", cursor: stepValid(step) ? "pointer" : "not-allowed" }}>
                Continue
              </button>
            ) : (
              <button onClick={() => void finish()} disabled={!stepValid(step) || saving}
                style={{ background: stepValid(step) && !saving ? "#C9A84C" : "#27272a", color: stepValid(step) && !saving ? "#000" : "#52525b", fontWeight: 700, fontSize: "14px", padding: "11px 24px", borderRadius: "10px", border: "none", cursor: stepValid(step) && !saving ? "pointer" : "not-allowed" }}>
                {saving ? "Saving…" : `Brief ${agentName}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <div>
      <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#52525b", marginBottom: "4px" }}>Step {n} of {TOTAL_STEPS}</div>
      <div style={{ fontSize: "18px", fontWeight: 600, color: "#fff" }}>{title}</div>
    </div>
  );
}
