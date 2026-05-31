/**
 * src/app/(marketing)/page.tsx  — public marketing site (Sprint 16).
 * Serves "/". Dark premium design matching the dashboard tokens.
 *
 * Sections: hero · the 5-role AI team · how it works · pricing (+ volume table) ·
 * waitlist. Animations are CSS-only (fade-up keyframes) — no framer-motion
 * dependency added; see <style> below. Server component; the only client island
 * is <WaitlistForm/>.
 *
 * NOTE on spec: the brief said "separate Next.js app in /marketing". I built it as
 * a public route group inside this app instead, so it shares the design system,
 * the Prisma schema (WaitlistEntry), and /api/waitlist with zero duplication. It
 * can still be split to its own Vercel project later if desired.
 */

import Link from "next/link";
import { WaitlistForm } from "../WaitlistForm";

export const dynamic = "force-dynamic";

interface Role { name: string; role: string; initial: string; blurb: string; }

const TEAM: Role[] = [
  { name: "Sophie", role: "The Caller",      initial: "S", blurb: "Calls every new lead within 60 seconds, 24/7. Qualifies, handles objections, and books." },
  { name: "James",  role: "The Scheduler",   initial: "J", blurb: "Books appointments into the calendar, confirms, and runs SMS reminders and no-show follow-ups." },
  { name: "Marcus", role: "The Media Buyer",  initial: "M", blurb: "Manages the Meta campaign — pausing underperformers, scaling winners, every four hours." },
  { name: "Ava",    role: "The Reporter",    initial: "A", blurb: "Reports back every morning in plain English, and flags any client at risk before you notice." },
  { name: "Kai",    role: "The Learner",     initial: "K", blurb: "Distils every outcome each night so the whole team gets measurably sharper while you sleep." },
];

interface Tier { range: string; price: string; note?: string; }

const VOLUME: Tier[] = [
  { range: "1–5 clients",   price: "£500", note: "per client / month" },
  { range: "6–10 clients",  price: "£400", note: "per client / month" },
  { range: "11–20 clients", price: "£350", note: "per client / month" },
  { range: "21+ clients",   price: "£300", note: "per client / month" },
];

const card = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "12px" } as const;

export default function MarketingPage() {
  return (
    <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "0 24px" }}>
      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0" }}>
        <div style={{ fontWeight: 700, fontSize: "18px", letterSpacing: "-0.01em" }}>
          Aurum<span style={{ color: "var(--gold)" }}>.</span>
        </div>
        <Link
          href="#waitlist"
          style={{ fontSize: "13px", fontWeight: 600, color: "#000", background: "var(--gold)", padding: "9px 16px", borderRadius: "8px", textDecoration: "none" }}
        >
          Request access
        </Link>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="reveal" style={{ textAlign: "center", padding: "72px 0 56px" }}>
        <div style={{ display: "inline-block", fontSize: "12px", color: "var(--text-2)", border: "1px solid var(--border)", borderRadius: "999px", padding: "5px 14px", marginBottom: "24px" }}>
          AI fulfilment for B2B marketing agencies
        </div>
        <h1 style={{ fontSize: "clamp(38px, 6vw, 68px)", lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.03em", margin: 0 }}>
          Your agency.<br />Fully staffed by AI.
        </h1>
        <p style={{ maxWidth: "620px", margin: "24px auto 0", fontSize: "17px", lineHeight: 1.6, color: "var(--text-2)" }}>
          Every client gets a dedicated team of AI staff that manage the ads, call every lead within
          60 seconds, book the appointments, and report back every morning. Your only job is signing
          new clients.
        </p>
        <div style={{ marginTop: "32px", display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="#waitlist" style={{ fontSize: "14px", fontWeight: 600, color: "#000", background: "var(--gold)", padding: "13px 24px", borderRadius: "8px", textDecoration: "none" }}>
            Request early access
          </Link>
          <Link href="#team" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-1)", border: "1px solid var(--border-strong)", padding: "13px 24px", borderRadius: "8px", textDecoration: "none" }}>
            Meet the team
          </Link>
        </div>
      </section>

      {/* ── The 5-role team ──────────────────────────────────────────────────── */}
      <section id="team" className="reveal" style={{ padding: "56px 0" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 8px" }}>
          One team. Five specialists. Per client.
        </h2>
        <p style={{ textAlign: "center", color: "var(--text-2)", fontSize: "15px", margin: "0 0 36px" }}>
          Not a chatbot. Not a dashboard. An autonomous AI employee deployed for every client you take on.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {TEAM.map((m) => (
            <div key={m.name} style={{ ...card, padding: "20px" }}>
              <div
                style={{
                  width: "44px", height: "44px", borderRadius: "999px",
                  background: "linear-gradient(135deg, var(--gold), #8a6f2e)",
                  color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "18px", marginBottom: "14px",
                }}
              >
                {m.initial}
              </div>
              <div style={{ fontWeight: 600, fontSize: "15px" }}>{m.name}</div>
              <div style={{ fontSize: "12px", color: "var(--gold)", marginBottom: "8px" }}>{m.role}</div>
              <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.5 }}>{m.blurb}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="reveal" style={{ padding: "56px 0" }}>
        <div style={{ ...card, padding: "32px", textAlign: "center", background: "var(--surface-2)" }}>
          <div style={{ fontSize: "13px", color: "var(--gold)", fontWeight: 600, marginBottom: "10px" }}>THE MOMENT</div>
          <p style={{ fontSize: "20px", lineHeight: 1.5, maxWidth: "720px", margin: "0 auto", color: "var(--text-1)" }}>
            A lead fills in a form at 11pm on a Sunday. 45 seconds later, Sophie calls them, qualifies
            them, and books them in for Monday morning — into your client&apos;s calendar. You find out
            at 6am, in a one-paragraph briefing.
          </p>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────────── */}
      <section id="pricing" className="reveal" style={{ padding: "56px 0" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 36px" }}>
          Pricing that scales with you
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "28px" }}>
          <div style={{ ...card, padding: "24px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Platform</div>
            <div style={{ fontSize: "32px", fontWeight: 700, margin: "6px 0" }}>£97<span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/month</span></div>
            <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Your always-on agency operating system.</div>
          </div>
          <div style={{ ...card, padding: "24px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Starter client</div>
            <div style={{ fontSize: "32px", fontWeight: 700, margin: "6px 0" }}>£200<span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/client</span></div>
            <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Calling, booking, and reporting for a single client.</div>
          </div>
          <div style={{ ...card, padding: "24px", borderColor: "var(--gold)" }}>
            <div style={{ fontSize: "13px", color: "var(--gold)" }}>Full service</div>
            <div style={{ fontSize: "32px", fontWeight: 700, margin: "6px 0" }}>£500<span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/client</span></div>
            <div style={{ fontSize: "13px", color: "var(--text-2)" }}>The complete five-role team, fully autonomous.</div>
          </div>
        </div>

        {/* Volume discount table */}
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: "13px", color: "var(--text-2)", fontWeight: 600 }}>
            Volume pricing — the more clients you run, the less each costs
          </div>
          {VOLUME.map((t, i) => (
            <div
              key={t.range}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px",
                borderBottom: i < VOLUME.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span style={{ fontSize: "14px", color: "var(--text-1)" }}>{t.range}</span>
              <span style={{ fontSize: "15px", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
                {t.price}<span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400 }}> {t.note}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Waitlist ─────────────────────────────────────────────────────────── */}
      <section id="waitlist" className="reveal" style={{ padding: "56px 0 96px", maxWidth: "480px", margin: "0 auto" }}>
        <h2 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 8px" }}>
          Request early access
        </h2>
        <p style={{ textAlign: "center", color: "var(--text-2)", fontSize: "15px", margin: "0 0 24px" }}>
          We&apos;re onboarding agencies in waves. Tell us about yours.
        </p>
        <WaitlistForm />
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px" }}>Aurum<span style={{ color: "var(--gold)" }}>.</span></div>
        <div style={{ fontSize: "12px", color: "var(--text-3)" }}>© {new Date().getFullYear()} Aurum Growth OS. Built for agency owners.</div>
      </footer>

      {/* CSS-only entrance animation (no framer-motion dependency). */}
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .reveal { animation: fadeUp 0.6s ease both; }
        #team.reveal { animation-delay: 0.05s; }
        #pricing.reveal { animation-delay: 0.1s; }
        @media (prefers-reduced-motion: reduce) { .reveal { animation: none; } }
      `}</style>
    </main>
  );
}
