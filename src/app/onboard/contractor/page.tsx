"use client";

/**
 * /onboard/contractor — PUBLIC self-serve contractor onboarding.
 * Steps: 1 details → 2 territory confirm → 3 Stripe £700 checkout (external) →
 * 4 calendar connect → 5 confirmation.
 *
 * After the Stripe redirect we return with ?paid=1&contractorId=…; after the
 * Google Calendar OAuth we return with ?connected=1&contractorId=… — the page
 * reads those on mount and resumes at the right step.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, CalendarClock, ShieldCheck, Loader2 } from "lucide-react";

type Vertical = "roofing" | "home_improvement";

interface FormState {
  name: string;
  companyName: string;
  phone: string;
  email: string;
  city: string;
  vertical: Vertical;
}

const card: React.CSSProperties = {
  background: "var(--surface-1, #0a0a0a)",
  border: "1px solid var(--border, rgba(255,255,255,0.08))",
  borderRadius: 12,
  padding: 28,
  width: "100%",
  maxWidth: 520,
};
const label: React.CSSProperties = { display: "block", fontSize: 13, color: "var(--text-2,#a1a1aa)", marginBottom: 6 };
const input: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-2,#111)",
  border: "1px solid var(--border,rgba(255,255,255,0.1))",
  borderRadius: 8,
  padding: "10px 12px",
  color: "var(--text-1,#fff)",
  fontSize: 15,
  marginBottom: 14,
};
const gold = "var(--gold,#C9A84C)";
const btn: React.CSSProperties = {
  width: "100%",
  background: gold,
  color: "#000",
  border: "none",
  borderRadius: 8,
  padding: "12px 16px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  ...btn,
  background: "transparent",
  color: "var(--text-2,#a1a1aa)",
  border: "1px solid var(--border,rgba(255,255,255,0.1))",
  marginTop: 10,
};

export default function ContractorOnboardingPage(): React.ReactElement {
  const [step, setStep] = useState<1 | 2 | 4 | 5>(1);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    companyName: "",
    phone: "",
    email: "",
    city: "",
    vertical: "roofing",
  });

  // Resume the flow after the Stripe / calendar redirects.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const cid = p.get("contractorId");
    if (cid) setContractorId(cid);
    if (p.get("connected") === "1") setStep(5);
    else if (p.get("paid") === "1") setStep(4);
    else if (p.get("cancelled") === "1") setStep(2);
  }, []);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const verticalLabel = form.vertical === "home_improvement" ? "home improvement" : "roofing";

  async function startCheckout(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contractors/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.checkoutUrl; // → Stripe
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  function goToDetails(): void {
    if (!form.name.trim() || !form.city.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Please add your name, a valid email, and your city.");
      return;
    }
    setError(null);
    setStep(2);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg,#000)",
        color: "var(--text-1,#fff)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ marginBottom: 20, fontWeight: 700, letterSpacing: 0.5, color: gold }}>AURUM</div>

      {step === 1 && (
        <div style={card}>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>Secure your territory</h1>
          <p style={{ color: "var(--text-2,#a1a1aa)", fontSize: 14, marginBottom: 20 }}>
            We generate the demand. You get booked site surveys dropped straight into your calendar.
          </p>
          <label style={label}>Your name</label>
          <input style={input} value={form.name} onChange={set("name")} placeholder="Jane Smith" />
          <label style={label}>Company (optional)</label>
          <input style={input} value={form.companyName} onChange={set("companyName")} placeholder="Smith Roofing Ltd" />
          <label style={label}>Phone</label>
          <input style={input} value={form.phone} onChange={set("phone")} placeholder="07700 900000" />
          <label style={label}>Email</label>
          <input style={input} type="email" value={form.email} onChange={set("email")} placeholder="jane@smithroofing.co.uk" />
          <label style={label}>City / territory</label>
          <input style={input} value={form.city} onChange={set("city")} placeholder="Manchester" />
          <label style={label}>Trade</label>
          <select style={input} value={form.vertical} onChange={set("vertical")}>
            <option value="roofing">Roofing</option>
            <option value="home_improvement">Home improvement</option>
          </select>
          {error && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button style={btn} onClick={goToDetails}>Continue</button>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <ShieldCheck size={28} color={gold} style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>
            Exclusive rights to {form.city || "your city"}
          </h1>
          <p style={{ color: "var(--text-2,#a1a1aa)", fontSize: 15, lineHeight: 1.6, marginBottom: 16 }}>
            You&apos;re securing exclusive rights to <strong style={{ color: "var(--text-1,#fff)" }}>{form.city || "your city"}</strong> for {verticalLabel} surveys.
          </p>
          <div style={{ background: "var(--surface-2,#111)", borderRadius: 8, padding: 16, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--text-2,#a1a1aa)" }}>Today (lock-in, first 2 surveys)</span>
              <strong>£700</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-2,#a1a1aa)" }}>Per confirmed survey after that</span>
              <strong>£350</strong>
            </div>
          </div>
          <p style={{ color: "var(--text-3,#52525b)", fontSize: 13, marginBottom: 18 }}>
            Each survey is a confirmed homeowner appointment booked into your calendar. You&apos;re only charged when one lands.
          </p>
          {error && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button style={btn} onClick={startCheckout} disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" style={{ verticalAlign: "middle" }} /> : `Pay £700 & secure ${form.city || "my city"}`}
          </button>
          <button style={ghostBtn} onClick={() => setStep(1)} disabled={submitting}>Back</button>
        </div>
      )}

      {step === 4 && (
        <div style={card}>
          <CalendarClock size={28} color={gold} style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Payment received — connect your calendar</h1>
          <p style={{ color: "var(--text-2,#a1a1aa)", fontSize: 15, lineHeight: 1.6, marginBottom: 20 }}>
            Connect the calendar where you want surveys booked. We&apos;ll drop each confirmed appointment straight in.
          </p>
          <a href={contractorId ? `/api/auth/google-calendar?contractorId=${contractorId}` : "#"} style={{ textDecoration: "none" }}>
            <button style={btn} disabled={!contractorId}>Connect Google Calendar</button>
          </a>
          <button style={ghostBtn} onClick={() => setStep(5)}>I&apos;ll connect it later</button>
        </div>
      )}

      {step === 5 && (
        <div style={{ ...card, textAlign: "center" }}>
          <CheckCircle2 size={40} color={gold} style={{ marginBottom: 14 }} />
          <h1 style={{ fontSize: 24, marginBottom: 10 }}>You&apos;re live.</h1>
          <p style={{ color: "var(--text-2,#a1a1aa)", fontSize: 15, lineHeight: 1.6 }}>
            Your territory is secured. We&apos;ll call you the moment your first survey is confirmed — and it&apos;ll be in your calendar.
          </p>
        </div>
      )}
    </main>
  );
}
