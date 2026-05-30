"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import type { ScrapeResult } from "@/app/api/clients/scrape-website/route";

// ── Static data ───────────────────────────────────────────────────────────────

const VERTICALS = [
  { label: "Personal Injury",    value: "personal_injury" },
  { label: "Cosmetic Surgery",   value: "cosmetic_surgery" },
  { label: "Aesthetics",         value: "aesthetics" },
  { label: "Roofing",            value: "roofing" },
  { label: "Real Estate",        value: "real_estate" },
  { label: "Hair Transplant",    value: "hair_transplant" },
  { label: "Dental",             value: "dental" },
  { label: "Financial Services", value: "financial_services" },
  { label: "Legal",              value: "legal" },
  { label: "Other",              value: "other" },
];

const VOICES = [
  { id: "female-british",  name: "Sophie",  gender: "Female", accent: "British" },
  { id: "female-american", name: "Madison", gender: "Female", accent: "American" },
  { id: "male-british",    name: "James",   gender: "Male",   accent: "British" },
  { id: "male-american",   name: "Tyler",   gender: "Male",   accent: "American" },
];

const STEP_TITLES_NEW:      string[] = ["", "Client details", "Connect Meta", "Connect calendar", "Your agent", "Review & deploy"];
const STEP_TITLES_TAKEOVER: string[] = ["", "Client details", "Connect Meta", "Deploy agent"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaStatus {
  connected:   boolean;
  adAccountId?: string;
  reason?:     string;
}

interface WizardData {
  businessName:        string;
  websiteUrl:          string;
  offer:               string;
  targetLocation:      string;
  vertical:            string;
  agentName:           string;
  voiceId:             string;
  dailyBudgetGbp:      string;
  metaAdAccountId:     string;
  existingCampaignIds: string[];
  websiteScrape:       ScrapeResult | null;
  clientTier:          string;
  clientContactName:   string;
  clientWhatsApp:      string;
}

const TIERS = [
  { id: "full_service", name: "Full service", price: "£500/mo", desc: "Ads, calls, booking, reporting" },
  { id: "starter",      name: "Starter",      price: "£200/mo", desc: "Calls & booking only" },
];

interface Props {
  onClose:   () => void;
  onSuccess: (agentName: string, businessName: string) => void;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const IS: CSSProperties = {
  width: "100%", background: "#111", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "8px", padding: "10px 12px", fontSize: "13px", color: "#fff",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

function Label({ children }: { children: string }) {
  return (
    <div style={{ fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
      {children}
    </div>
  );
}

function Err({ msg }: { msg?: string }) {
  return msg ? <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "4px" }}>{msg}</div> : null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddClientWizard({ onClose, onSuccess }: Props) {
  const [mode,       setMode]       = useState<"new" | "takeover" | null>(null);
  const [step,       setStep]       = useState(0);
  const [data,       setData]       = useState<WizardData>({
    businessName: "", websiteUrl: "", offer: "", targetLocation: "",
    vertical: "", agentName: "", voiceId: "female-british",
    dailyBudgetGbp: "50", metaAdAccountId: "",
    existingCampaignIds: [], websiteScrape: null,
    clientTier: "full_service",
    clientContactName: "", clientWhatsApp: "",
  });
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [scraping,   setScraping]   = useState(false);

  const totalSteps = mode === "new" ? 5 : 3;
  const isLastStep = mode !== null && step === totalSteps;

  // Fetch Meta status when reaching step 2
  useEffect(() => {
    if (mode !== null && step === 2 && metaStatus === null) {
      fetch("/api/auth/meta/status")
        .then(r => r.ok ? r.json() as Promise<MetaStatus> : Promise.resolve({ connected: false } as MetaStatus))
        .then(s => {
          setMetaStatus(s);
          if (s.connected && s.adAccountId) {
            setData(d => ({ ...d, metaAdAccountId: s.adAccountId! }));
          }
        })
        .catch(() => setMetaStatus({ connected: false }));
    }
  }, [mode, step, metaStatus]);

  const upd = useCallback((k: keyof WizardData, v: string | string[] | ScrapeResult | null) => {
    setData(d => ({ ...d, [k]: v }));
    setErrors(e => ({ ...e, [k]: "" }));
  }, []);

  // Website scraping on URL blur
  const handleUrlBlur = useCallback(async (url: string) => {
    if (!url.trim() || scraping) return;
    setScraping(true);
    try {
      const res = await fetch("/api/clients/scrape-website", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url }),
      });
      if (!res.ok) return;
      const result = (await res.json()) as ScrapeResult;
      setData(d => ({
        ...d,
        offer:        d.offer || result.description || result.offer,
        websiteScrape: result,
      }));
    } catch {
      // non-fatal
    } finally {
      setScraping(false);
    }
  }, [scraping]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!data.businessName.trim()) e.businessName = "Required";
      if (!data.vertical)            e.vertical     = "Required";
    }
    const agentStep = mode === "new" ? 4 : 3;
    if (step === agentStep && !data.agentName.trim()) e.agentName = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => { if (validate()) setStep(s => s + 1); };
  const back = () => {
    if (step <= 1) { setMode(null); setStep(0); }
    else setStep(s => s - 1);
  };

  const deploy = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/clients/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          businessName:       data.businessName,
          websiteUrl:         data.websiteUrl,
          offer:              data.offer,
          targetLocation:     data.targetLocation || "UK",
          vertical:           data.vertical,
          agentName:          data.agentName,
          voiceId:            data.voiceId,
          dailyBudgetGbp:     Number(data.dailyBudgetGbp) || 50,
          metaAdAccountId:    data.metaAdAccountId,
          isExistingCampaign: mode === "takeover",
          existingCampaignIds: data.existingCampaignIds,
          websiteScrape:      data.websiteScrape,
          clientTier:         data.clientTier,
          clientContactName:  data.clientContactName,
          clientWhatsApp:     data.clientWhatsApp,
        }),
      });
      if (!res.ok) throw new Error("Deploy failed");
      const result = (await res.json()) as { blueprintId: string; agentName: string };
      onSuccess(result.agentName, data.businessName);
      onClose();
    } catch {
      setErrors({ submit: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step content ──────────────────────────────────────────────────────────

  const stepClientDetails = (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <Label>Business name *</Label>
        <input style={IS} placeholder="e.g. Smith Roofing" value={data.businessName}
          onChange={e => upd("businessName", e.target.value)} />
        <Err msg={errors.businessName} />
      </div>
      <div>
        <Label>Website URL (optional)</Label>
        <div style={{ position: "relative" }}>
          <input
            style={IS}
            placeholder="https://example.com"
            value={data.websiteUrl}
            onChange={e => upd("websiteUrl", e.target.value)}
            onBlur={e => void handleUrlBlur(e.target.value)}
          />
          {scraping && (
            <div style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#C9A84C" }}>
              <div style={{ width: "10px", height: "10px", border: "1.5px solid rgba(201,168,76,0.3)", borderTopColor: "#C9A84C", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Reading…
            </div>
          )}
        </div>
        <div style={{ fontSize: "11px", color: "#444", marginTop: "4px" }}>
          {data.websiteScrape ? "✓ Website read — offer auto-filled below" : "We'll read this to brief your agent"}
        </div>
      </div>
      <div>
        <Label>What do they sell? (offer)</Label>
        <textarea
          style={{ ...IS, resize: "vertical", minHeight: "72px" }}
          placeholder="Describe their offer, product or service..."
          value={data.offer}
          onChange={e => upd("offer", e.target.value)}
        />
      </div>
      <div>
        <Label>Target location</Label>
        <input style={IS} placeholder="e.g. London, Manchester, UK-wide"
          value={data.targetLocation} onChange={e => upd("targetLocation", e.target.value)} />
      </div>
      <div>
        <Label>Industry *</Label>
        <select style={{ ...IS, cursor: "pointer" }} value={data.vertical}
          onChange={e => upd("vertical", e.target.value)}>
          <option value="">Select industry…</option>
          {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <Err msg={errors.vertical} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <Label>Client contact name</Label>
          <input style={IS} placeholder="e.g. Jane Smith"
            value={data.clientContactName} onChange={e => upd("clientContactName", e.target.value)} />
        </div>
        <div>
          <Label>Client WhatsApp</Label>
          <input style={IS} placeholder="+447…"
            value={data.clientWhatsApp} onChange={e => upd("clientWhatsApp", e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: "11px", color: "#444", marginTop: "-6px" }}>
        Optional — we&apos;ll send them a monthly WhatsApp summary from your agent.
      </div>
    </div>
  );

  const stepMeta = (showCampaigns: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {metaStatus === null ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#555", fontSize: "13px" }}>
          <div style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#C9A84C", borderRadius: "50%" }} className="animate-spin" />
          Checking Meta connection…
        </div>
      ) : metaStatus.connected ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "8px" }}>
          <span style={{ color: "#22c55e", fontSize: "16px" }}>✓</span>
          <div>
            <div style={{ fontSize: "13px", color: "#22c55e", fontWeight: 500 }}>Meta connected</div>
            <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>Ad account: {metaStatus.adAccountId}</div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: "13px", color: "#888", marginBottom: "16px" }}>
            Connect your Meta Ads account to run campaigns for this client.
          </div>
          <a href="/api/auth/meta" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 18px", background: "#1877F2", borderRadius: "8px", color: "#fff", fontSize: "13px", fontWeight: 500, textDecoration: "none" }}>
            Connect Meta Ads
          </a>
        </div>
      )}

      {metaStatus?.connected && (
        <div>
          <Label>Daily budget (£/day)</Label>
          <input type="number" min="1" style={{ ...IS, width: "160px" }}
            placeholder="50" value={data.dailyBudgetGbp}
            onChange={e => upd("dailyBudgetGbp", e.target.value)} />
        </div>
      )}

      {showCampaigns && metaStatus?.connected && (
        <div>
          <Label>Existing campaign IDs to manage</Label>
          <input
            style={IS}
            placeholder="Paste campaign IDs, comma-separated"
            value={data.existingCampaignIds.join(", ")}
            onChange={e => upd("existingCampaignIds",
              e.target.value.split(",").map(s => s.trim()).filter(Boolean)
            )}
          />
          <div style={{ fontSize: "11px", color: "#444", marginTop: "4px" }}>
            Find these in Meta Ads Manager → Campaigns
          </div>
        </div>
      )}
    </div>
  );

  const stepCalendar = (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}>
        Connect a calendar so your agent can book appointments directly.
      </div>
      {[
        { href: "/api/auth/google-calendar", icon: "📅", label: "Google Calendar", sub: "Connect your Google Workspace calendar" },
        { href: "/api/auth/calendly",         icon: "🗓", label: "Calendly",        sub: "Use your existing Calendly booking page" },
      ].map(opt => (
        <a key={opt.href} href={opt.href}
          style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", color: "#fff", textDecoration: "none", transition: "border-color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
        >
          <span style={{ fontSize: "20px" }}>{opt.icon}</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500 }}>{opt.label}</div>
            <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{opt.sub}</div>
          </div>
        </a>
      ))}
    </div>
  );

  const stepAgent = (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <Label>Agent name *</Label>
        <input
          style={{ ...IS, fontSize: "15px" }}
          placeholder="e.g. Sophie, Marcus, Jake"
          value={data.agentName}
          onChange={e => upd("agentName", e.target.value)}
          autoFocus
        />
        <div style={{ fontSize: "12px", color: "#444", marginTop: "6px" }}>
          This is who will call your leads and report back to you.
        </div>
        <Err msg={errors.agentName} />
      </div>

      <div>
        <Label>Voice</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {VOICES.map(v => {
            const active = data.voiceId === v.id;
            return (
              <button key={v.id} onClick={() => upd("voiceId", v.id)} style={{
                padding: "12px 14px", textAlign: "left", cursor: "pointer", transition: "all 0.1s",
                background: active ? "rgba(201,168,76,0.08)" : "#111",
                border: `1px solid ${active ? "#C9A84C" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "8px",
              }}>
                <div style={{ fontSize: "13px", fontWeight: active ? 600 : 400, color: active ? "#C9A84C" : "#ccc" }}>
                  {v.name}
                </div>
                <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{v.gender} · {v.accent}</div>
                <div style={{ fontSize: "10px", color: "#333", marginTop: "4px" }}>preview</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Plan</Label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {TIERS.map(t => {
            const active = data.clientTier === t.id;
            return (
              <button key={t.id} onClick={() => upd("clientTier", t.id)} style={{
                padding: "12px 14px", textAlign: "left", cursor: "pointer", transition: "all 0.1s",
                background: active ? "rgba(201,168,76,0.08)" : "#111",
                border: `1px solid ${active ? "#C9A84C" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "8px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "13px", fontWeight: active ? 600 : 400, color: active ? "#C9A84C" : "#ccc" }}>{t.name}</span>
                  <span className="font-mono" style={{ fontSize: "11px", color: active ? "#C9A84C" : "#666" }}>{t.price}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#555", marginTop: "3px" }}>{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {data.agentName && (
        <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px" }}>
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>Preview</div>
          <div style={{ fontSize: "13px", color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
            &ldquo;Hi, I&apos;m {data.agentName}, calling from {data.businessName || "[business name]"}. Is now a good time to chat?&rdquo;
          </div>
        </div>
      )}
    </div>
  );

  const verticalLabel = VERTICALS.find(v => v.value === data.vertical)?.label ?? "—";
  const voiceLabel    = VOICES.find(v => v.id === data.voiceId)?.name ?? "—";

  const reviewRows: [string, string][] = [
    ["Client",   data.businessName || "—"],
    ["Industry", verticalLabel],
    ["Location", data.targetLocation || "UK"],
    ["Meta",     metaStatus?.connected ? `Connected · ${metaStatus.adAccountId ?? ""}` : "Not connected"],
    ["Budget",   `£${data.dailyBudgetGbp}/day`],
    ["Agent",    data.agentName || "—"],
    ["Voice",    voiceLabel],
    ["Plan",     TIERS.find(t => t.id === data.clientTier)?.name ?? "Full service"],
  ];

  const stepReview = (
    <div>
      {reviewRows.map(([k, v], i) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: i < reviewRows.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
          <span style={{ fontSize: "12px", color: "#555", flexShrink: 0 }}>{k}</span>
          <span style={{ fontSize: "12px", color: "#ccc", fontWeight: 500, textAlign: "right", maxWidth: "300px" }}>{v}</span>
        </div>
      ))}
    </div>
  );

  const renderContent = () => {
    if (!mode) return null;
    if (mode === "new") {
      switch (step) {
        case 1: return stepClientDetails;
        case 2: return stepMeta(false);
        case 3: return stepCalendar;
        case 4: return stepAgent;
        case 5: return stepReview;
      }
    } else {
      switch (step) {
        case 1: return stepClientDetails;
        case 2: return stepMeta(true);
        case 3: return (
          <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
            {stepAgent}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "20px" }}>
              <div style={{ fontSize: "12px", color: "#444", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>Summary</div>
              {stepReview}
            </div>
          </div>
        );
      }
    }
    return null;
  };

  const stepTitle = mode
    ? (mode === "new" ? STEP_TITLES_NEW : STEP_TITLES_TAKEOVER)[step] ?? ""
    : "Add a client";

  const dots = mode
    ? Array.from({ length: totalSteps }, (_, i) => ({ n: i + 1, done: i + 1 < step, active: i + 1 === step }))
    : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div
        style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)" }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          style={{ width: "100%", maxWidth: "560px", margin: "0 16px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", overflow: "hidden", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "22px 24px 0" }}>
            <div>
              {step > 0 && (
                <button onClick={back} style={{ fontSize: "12px", color: "#555", background: "none", border: "none", cursor: "pointer", padding: 0, display: "block", marginBottom: "6px" }}>
                  ← Back
                </button>
              )}
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>{step === 0 ? "Add a client" : stepTitle}</div>
            </div>
            <button onClick={onClose} style={{ color: "#444", background: "none", border: "none", fontSize: "22px", cursor: "pointer", lineHeight: 1, paddingLeft: "16px" }}>×</button>
          </div>

          {/* Progress dots */}
          {dots.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "12px 24px 0" }}>
              {dots.map(d => (
                <div key={d.n} style={{ width: "6px", height: "6px", borderRadius: "50%", transition: "background 0.2s", background: d.done ? "#22c55e" : d.active ? "#C9A84C" : "#27272a" }} />
              ))}
              <span style={{ fontSize: "11px", color: "#444", marginLeft: "6px" }}>{step} of {totalSteps}</span>
            </div>
          )}

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {step === 0 ? (
              /* Choice screen */
              <div style={{ padding: "32px 24px" }}>
                <div style={{ fontSize: "13px", color: "#555", marginBottom: "24px" }}>How do you want to start?</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  {[
                    { key: "new" as const,      title: "Start fresh",        desc: "Build everything from scratch — ads, landing page, AI agent." },
                    { key: "takeover" as const, title: "Take over existing",  desc: "Connect to Meta campaigns already running for this client." },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => { setMode(opt.key); setStep(1); }}
                      style={{ textAlign: "left", padding: "20px", background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", cursor: "pointer", transition: "border-color 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
                    >
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "8px" }}>{opt.title}</div>
                      <div style={{ fontSize: "12px", color: "#555", lineHeight: 1.5 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: "24px" }}>
                {renderContent()}

                {errors.submit && (
                  <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "12px" }}>{errors.submit}</div>
                )}

                {/* Footer */}
                <div style={{ marginTop: "28px" }}>
                  {isLastStep ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                      <button
                        onClick={() => void deploy()}
                        disabled={submitting}
                        style={{ width: "100%", background: submitting ? "#333" : "#C9A84C", color: "#000", fontWeight: 700, fontSize: "14px", padding: "14px 24px", borderRadius: "8px", border: "none", cursor: submitting ? "not-allowed" : "pointer", transition: "opacity 0.1s" }}
                      >
                        {submitting ? "Deploying…" : `Deploy ${data.agentName || "Agent"}`}
                      </button>
                      {data.agentName && !submitting && (
                        <div style={{ fontSize: "12px", color: "#444" }}>
                          {data.agentName} will be live within 60 seconds
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px" }}>
                      {/* Skip on calendar step */}
                      {mode === "new" && step === 3 && (
                        <button onClick={() => setStep(s => s + 1)} style={{ fontSize: "12px", color: "#555", background: "none", border: "none", cursor: "pointer" }}>
                          Skip
                        </button>
                      )}
                      <button
                        onClick={next}
                        style={{ background: "#fff", color: "#000", fontWeight: 500, fontSize: "13px", padding: "10px 22px", borderRadius: "8px", border: "none", cursor: "pointer" }}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
