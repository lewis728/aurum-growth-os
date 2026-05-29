"use client";
/**
 * src/components/onboarding/BrandingConfig.tsx
 *
 * Agency white-label branding configuration form.
 * Fetches current branding from GET /api/agency/branding on mount,
 * saves changes via PATCH /api/agency/branding.
 *
 * Fields:
 *   - Agency name
 *   - Logo URL
 *   - Primary colour (hex, no #)
 *   - Accent colour (hex, no #)
 *   - Custom domain + DNS CNAME instructions
 *   - Domain verification status badge
 *   - Support email
 *   - From name
 *   - Onboarding welcome message
 *
 * Design: white background, Aurum gold accent (#C9A84C), Inter font.
 * Agency-owner framing throughout — "your clients", "your agency".
 */

import {
  useState,
  useEffect,
  useCallback,
  type ChangeEvent,
  type FormEvent,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BrandingData {
  agencyName:               string;
  logoUrl:                  string | null;
  primaryColour:            string;
  accentColour:             string;
  customDomain:             string | null;
  supportEmail:             string | null;
  fromName:                 string | null;
  onboardingWelcomeMessage: string | null;
}

interface DomainStatus {
  verified:    boolean;
  cnameTarget: string | undefined;
  domain:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexValid(v: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(v);
}

function ColourSwatch({ hex }: { hex: string }): JSX.Element {
  const safe = hexValid(hex) ? hex : "C9A84C";
  return (
    <span
      className="inline-block w-5 h-5 rounded border border-gray-200 align-middle"
      style={{ backgroundColor: `#${safe}` }}
      aria-hidden="true"
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BrandingConfig(): JSX.Element {
  const [form, setForm] = useState<BrandingData>({
    agencyName:               "",
    logoUrl:                  null,
    primaryColour:            "C9A84C",
    accentColour:             "FFFFFF",
    customDomain:             null,
    supportEmail:             null,
    fromName:                 null,
    onboardingWelcomeMessage: null,
  });

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState<DomainStatus | null>(null);
  const [verifying,  setVerifying]  = useState(false);

  // ── Load branding on mount ─────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch("/api/agency/branding");
        const data = (await res.json()) as BrandingData;
        setForm({
          agencyName:               data.agencyName               ?? "",
          logoUrl:                  data.logoUrl                  ?? null,
          primaryColour:            data.primaryColour            ?? "C9A84C",
          accentColour:             data.accentColour             ?? "FFFFFF",
          customDomain:             data.customDomain             ?? null,
          supportEmail:             data.supportEmail             ?? null,
          fromName:                 data.fromName                 ?? null,
          onboardingWelcomeMessage: data.onboardingWelcomeMessage ?? null,
        });
      } catch {
        setError("Could not load branding settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Field change handler ───────────────────────────────────────────────────
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setForm((prev) => ({
        ...prev,
        [name]: value === "" ? null : value,
      }));
      setSaved(false);
    },
    []
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/agency/branding", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(form),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setSaved(true);
        // Re-check domain status if a domain is set
        if (form.customDomain) {
          void checkDomain();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form]
  );

  // ── Domain verification ───────────────────────────────────────────────────
  const checkDomain = useCallback(async () => {
    setVerifying(true);
    try {
      const res  = await fetch("/api/agency/branding/verify-domain");
      const data = (await res.json()) as DomainStatus & { error?: string };
      if (res.ok) {
        setDomainStatus(data);
      }
    } catch {
      // non-fatal
    } finally {
      setVerifying(false);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-8"
      aria-label="Agency branding settings"
    >
      {/* ── Live colour preview ─────────────────────────────────────────── */}
      <div
        className="rounded-xl border border-gray-100 p-5 flex items-center gap-4"
        style={{
          background: hexValid(form.primaryColour ?? "")
            ? `linear-gradient(135deg, #${form.primaryColour} 0%, #${form.accentColour ?? "FFFFFF"} 100%)`
            : "linear-gradient(135deg, #C9A84C 0%, #FFFFFF 100%)",
        }}
      >
        {form.logoUrl ? (
          <img
            src={form.logoUrl}
            alt="Agency logo preview"
            className="w-12 h-12 rounded-lg object-contain bg-white border border-white/40"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-white/30 flex items-center justify-center">
            <span className="text-xl font-bold text-white">
              {(form.agencyName || "A").charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <p className="text-sm font-semibold text-white drop-shadow">
            {form.agencyName || "Your Agency Name"}
          </p>
          <p className="text-xs text-white/80 drop-shadow">Brand preview</p>
        </div>
      </div>

      {/* ── Agency identity ─────────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-[#111827] mb-4 uppercase tracking-wide">
          Agency Identity
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Agency Name"
            name="agencyName"
            value={form.agencyName ?? ""}
            onChange={handleChange}
            placeholder="e.g. Aurum Growth Agency"
            required
          />
          <Field
            label="From Name"
            name="fromName"
            value={form.fromName ?? ""}
            onChange={handleChange}
            placeholder="e.g. Lewis at Aurum"
            hint="Displayed as the sender name in client emails"
          />
          <Field
            label="Logo URL"
            name="logoUrl"
            value={form.logoUrl ?? ""}
            onChange={handleChange}
            placeholder="https://cdn.example.com/logo.png"
            hint="Direct link to your agency logo (PNG or SVG)"
            className="sm:col-span-2"
          />
          <Field
            label="Support Email"
            name="supportEmail"
            type="email"
            value={form.supportEmail ?? ""}
            onChange={handleChange}
            placeholder="support@youragency.com"
          />
        </div>
      </section>

      {/* ── Brand colours ───────────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-[#111827] mb-4 uppercase tracking-wide">
          Brand Colours
        </h3>
        <p className="text-xs text-[#6B7280] mb-4">
          Enter 6-character hex codes without the # symbol. These colours are
          applied across your client-facing pages and onboarding flows.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Primary Colour{" "}
              <ColourSwatch hex={form.primaryColour ?? ""} />
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#9CA3AF]">#</span>
              <input
                type="text"
                name="primaryColour"
                value={form.primaryColour ?? ""}
                onChange={handleChange}
                maxLength={6}
                placeholder="C9A84C"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              />
            </div>
            {form.primaryColour && !hexValid(form.primaryColour) && (
              <p className="text-xs text-red-500 mt-1">Must be 6 hex characters</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Accent Colour{" "}
              <ColourSwatch hex={form.accentColour ?? ""} />
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#9CA3AF]">#</span>
              <input
                type="text"
                name="accentColour"
                value={form.accentColour ?? ""}
                onChange={handleChange}
                maxLength={6}
                placeholder="FFFFFF"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
              />
            </div>
            {form.accentColour && !hexValid(form.accentColour) && (
              <p className="text-xs text-red-500 mt-1">Must be 6 hex characters</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Custom domain ───────────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-[#111827] mb-4 uppercase tracking-wide">
          Custom Domain
        </h3>
        <p className="text-xs text-[#6B7280] mb-4">
          Point your own domain at this platform so your clients see your brand,
          not ours. Enter the domain below, save, then add the CNAME record shown
          to your DNS provider.
        </p>
        <Field
          label="Custom Domain"
          name="customDomain"
          value={form.customDomain ?? ""}
          onChange={handleChange}
          placeholder="app.youragency.com"
        />

        {/* DNS instructions */}
        {form.customDomain && (
          <div className="mt-4 rounded-xl bg-[#FAFAF9] border border-gray-100 p-4">
            <p className="text-xs font-semibold text-[#374151] mb-2">
              DNS Configuration
            </p>
            <p className="text-xs text-[#6B7280] mb-3">
              Add the following CNAME record at your DNS provider, then click
              &ldquo;Check DNS&rdquo; to confirm propagation.
            </p>
            <div className="font-mono text-xs bg-white border border-gray-200 rounded-lg p-3 space-y-1">
              <div className="flex gap-4">
                <span className="text-[#9CA3AF] w-16 shrink-0">Type</span>
                <span className="text-[#111827]">CNAME</span>
              </div>
              <div className="flex gap-4">
                <span className="text-[#9CA3AF] w-16 shrink-0">Name</span>
                <span className="text-[#111827]">{form.customDomain}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-[#9CA3AF] w-16 shrink-0">Target</span>
                <span className="text-[#111827]">
                  {domainStatus?.cnameTarget ?? "cname.vercel-dns.com"}
                </span>
              </div>
            </div>

            {/* Verification status */}
            <div className="mt-3 flex items-center gap-3">
              {domainStatus ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    domainStatus.verified
                      ? "bg-green-50 text-green-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      domainStatus.verified ? "bg-green-500" : "bg-amber-400"
                    }`}
                  />
                  {domainStatus.verified ? "Verified" : "Pending DNS propagation"}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void checkDomain()}
                disabled={verifying}
                className="text-xs text-[#C9A84C] hover:underline disabled:opacity-50"
              >
                {verifying ? "Checking…" : "Check DNS"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Onboarding welcome message ───────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-[#111827] mb-4 uppercase tracking-wide">
          Onboarding Welcome Message
        </h3>
        <p className="text-xs text-[#6B7280] mb-3">
          Shown to your clients at the start of their onboarding conversation.
          Personalise it to reflect your agency&rsquo;s voice.
        </p>
        <textarea
          name="onboardingWelcomeMessage"
          value={form.onboardingWelcomeMessage ?? ""}
          onChange={handleChange}
          rows={4}
          placeholder="Welcome! I'm here to help set up your campaign. Let's start by understanding your business…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40 resize-none"
        />
      </section>

      {/* ── Error / success ──────────────────────────────────────────────── */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-green-700 bg-green-50 rounded-lg px-4 py-2">
          Branding settings saved.
        </p>
      )}

      {/* ── Save button ──────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
          style={{ backgroundColor: "#C9A84C" }}
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            "Save Branding"
          )}
        </button>
      </div>
    </form>
  );
}

// ── Reusable field ─────────────────────────────────────────────────────────────
interface FieldProps {
  label:       string;
  name:        string;
  value:       string;
  onChange:    (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  hint?:        string;
  type?:        string;
  required?:    boolean;
  className?:   string;
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  required,
  className,
}: FieldProps): JSX.Element {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-[#374151] mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"
      />
      {hint && <p className="text-xs text-[#9CA3AF] mt-1">{hint}</p>}
    </div>
  );
}
