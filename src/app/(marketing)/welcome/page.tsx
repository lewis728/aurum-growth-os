"use client";

/**
 * src/app/(marketing)/welcome/page.tsx — public marketing site (Sprint 16,
 * cinematic redesign). Apple.com meets Linear.app: premium, kinetic, alive.
 *
 * Client component so we can drive scroll-triggered reveals, a scroll-blur sticky
 * header, and count-up numbers with a vanilla IntersectionObserver — NO new npm
 * packages. All motion is CSS keyframes/transitions; everything degrades cleanly
 * under prefers-reduced-motion. The only other island is <WaitlistForm/>, which
 * owns the /api/waitlist POST.
 *
 * Metadata lives in (marketing)/layout.tsx (a server component), so this file
 * needs no route-segment config.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WaitlistForm } from "../WaitlistForm";

// ── Data ────────────────────────────────────────────────────────────────────
interface Role { name: string; role: string; initial: string; color: string; grad: string; blurb: string; }

const TEAM: Role[] = [
  { name: "Sophie", role: "The Caller",     initial: "S", color: "#C9A84C", grad: "linear-gradient(135deg,#E8C766,#8a6f2e)", blurb: "Calls every new lead within 60 seconds, 24/7. Qualifies, handles objections, and books." },
  { name: "James",  role: "The Scheduler",  initial: "J", color: "#3b82f6", grad: "linear-gradient(135deg,#60a5fa,#1e3a8a)", blurb: "Books appointments into the calendar, confirms, and runs SMS reminders and no-show follow-ups." },
  { name: "Marcus", role: "The Media Buyer", initial: "M", color: "#8b5cf6", grad: "linear-gradient(135deg,#a78bfa,#4c1d95)", blurb: "Manages the Meta campaign — pausing underperformers, scaling winners, every four hours." },
  { name: "Ava",    role: "The Reporter",   initial: "A", color: "#ec4899", grad: "linear-gradient(135deg,#f472b6,#831843)", blurb: "Reports back every morning in plain English, and flags any client at risk before you notice." },
  { name: "Kai",    role: "The Learner",    initial: "K", color: "#a1a1aa", grad: "linear-gradient(135deg,#d4d4d8,#3f3f46)", blurb: "Distils every outcome each night so the whole team gets measurably sharper while you sleep." },
];

interface Tier { range: string; price: string; note: string; }
const VOLUME: Tier[] = [
  { range: "1–5 clients",   price: "£500", note: "per client / month" },
  { range: "6–10 clients",  price: "£400", note: "per client / month" },
  { range: "11–20 clients", price: "£350", note: "per client / month" },
  { range: "21+ clients",   price: "£300", note: "per client / month" },
];

const TICKER = [
  "Sophie called James Wright — Booked · 2m ago",
  "Marcus scaled budget 20% — CPL dropped to £34 · 4m ago",
  "James confirmed a 10:30 consultation · 12m ago",
  "Sophie recovered a silent lead — Booked · 38m ago",
  "Kai distilled 41 outcomes overnight · 5h ago",
  "Ava sent morning briefing to Lewis · 6h ago",
];

const HERO_WORDS = ["Your", "agency.", "Fully", "staffed", "by", "AI."];

const card = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "12px" } as const;
const cssVar = (k: string, v: string) => ({ [k as string]: v } as React.CSSProperties);

// ── Count-up number (animates when scrolled into view) ──────────────────────
function CountUp({ to, prefix = "", duration = 1100 }: { to: number; prefix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVal(to); return; }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const step = (now: number) => {
              const t = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - t, 3);
              setVal(Math.round(to * eased));
              if (t < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return <span ref={ref}>{prefix}{val.toLocaleString("en-GB")}</span>;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingPage() {
  const [scrolled, setScrolled] = useState(false);

  // Scroll-blur sticky header.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-triggered reveals — every [data-reveal] fades up once on entry.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* ── Sticky header (blur backdrop on scroll) ──────────────────────────── */}
      <header className={`site-header${scrolled ? " scrolled" : ""}`}>
        <div style={{ maxWidth: "1120px", margin: "0 auto", padding: "0 24px", height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, fontSize: "18px", letterSpacing: "-0.01em" }}>
            Aurum<span style={{ color: "var(--gold)" }}>.</span>
          </div>
          <Link href="#waitlist" className="shimmer-btn" style={{ fontSize: "13px", fontWeight: 600, color: "#000", padding: "9px 16px", borderRadius: "8px", textDecoration: "none" }}>
            Request access
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: "1120px", margin: "0 auto", padding: "0 24px", position: "relative" }}>
        {/* ── Hero ───────────────────────────────────────────────────────────── */}
        <section style={{ position: "relative", textAlign: "center", padding: "96px 0 48px", overflow: "hidden" }}>
          {/* Dot-grid backdrop fading to black */}
          <div className="dot-grid" aria-hidden />
          {/* Pulsing gold orb */}
          <div className="hero-orb" aria-hidden />

          <div style={{ position: "relative" }}>
            <div className="hero-pill" style={{ display: "inline-block", fontSize: "12px", color: "var(--text-2)", border: "1px solid var(--border)", borderRadius: "999px", padding: "5px 14px", marginBottom: "28px" }}>
              AI fulfilment for B2B marketing agencies
            </div>

            <h1 style={{ fontSize: "clamp(40px, 6.6vw, 76px)", lineHeight: 1.04, fontWeight: 700, letterSpacing: "-0.035em", margin: 0 }}>
              {HERO_WORDS.map((w, i) => (
                <span
                  key={i}
                  className="hero-word"
                  style={{ ...cssVar("--d", `${0.12 + i * 0.09}s`), display: "inline-block", marginRight: "0.22em", ...(w === "AI." ? { color: "var(--gold)" } : null) }}
                >
                  {w}
                </span>
              ))}
            </h1>

            <p style={{ maxWidth: "620px", margin: "26px auto 0", fontSize: "17px", lineHeight: 1.6, color: "var(--text-2)" }}>
              Every client gets a dedicated team of AI staff that manage the ads, call every lead within
              60 seconds, book the appointments, and report back every morning. Your only job is signing
              new clients.
            </p>

            <div style={{ marginTop: "34px", display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="#waitlist" className="shimmer-btn" style={{ fontSize: "14px", fontWeight: 600, color: "#000", padding: "13px 26px", borderRadius: "8px", textDecoration: "none" }}>
                Request early access
              </Link>
              <Link href="#team" className="ghost-btn" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-1)", border: "1px solid var(--border-strong)", padding: "13px 24px", borderRadius: "8px", textDecoration: "none" }}>
                Meet the team
              </Link>
            </div>
          </div>

          {/* Live activity ticker */}
          <div className="ticker-wrap" style={{ marginTop: "56px", position: "relative" }}>
            <div className="ticker-track">
              {[...TICKER, ...TICKER].map((t, i) => (
                <span key={i} className="ticker-item">
                  <span className="ticker-dot" />{t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── The 5-role team ────────────────────────────────────────────────── */}
        <section id="team" style={{ padding: "72px 0" }}>
          <div data-reveal>
            <div className="kicker">THE TEAM</div>
            <h2 style={{ fontSize: "clamp(26px,3.4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 8px" }}>
              One team. Five specialists. Per client.
            </h2>
            <p style={{ textAlign: "center", color: "var(--text-2)", fontSize: "15px", margin: "0 0 40px" }}>
              Not a chatbot. Not a dashboard. An autonomous AI employee deployed for every client you take on.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "16px" }}>
            {TEAM.map((m, i) => (
              <div
                key={m.name}
                data-reveal
                className="team-card"
                style={{ ...card, padding: "22px", ...cssVar("--glow", m.color), transitionDelay: `${i * 60}ms` }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div
                    style={{
                      width: "52px", height: "52px", borderRadius: "14px", background: m.grad,
                      color: "#000", display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 700, fontSize: "22px", boxShadow: `0 6px 20px -8px ${m.color}`,
                    }}
                  >
                    {m.initial}
                  </div>
                  <span className="active-tag">
                    <span className="active-dot" />Active
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: "16px" }}>{m.name}</div>
                <div style={{ fontSize: "12px", color: m.color, marginBottom: "10px", fontWeight: 500 }}>{m.role}</div>
                <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.55 }}>{m.blurb}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── The Moment ─────────────────────────────────────────────────────── */}
        <section style={{ padding: "72px 0" }}>
          <div data-reveal className="moment" style={{ ...card, position: "relative", overflow: "hidden", padding: "clamp(40px,7vw,88px) 28px", textAlign: "center" }}>
            <div className="moment-bg" aria-hidden />
            <div style={{ position: "relative" }}>
              <div className="kicker">THE MOMENT</div>
              <p style={{ fontSize: "clamp(24px,3.8vw,40px)", lineHeight: 1.34, fontWeight: 600, maxWidth: "880px", margin: "0 auto", color: "var(--text-1)", letterSpacing: "-0.02em" }}>
                A lead fills in a form at 11pm on a Sunday.{" "}
                <span className="gold-em">45 seconds</span> later, Sophie calls them, qualifies them, and
                books them in for Monday morning — into your client&apos;s calendar. You find out at{" "}
                <span className="gold-em">6am</span>, in a <span className="gold-em">one-paragraph briefing</span>.
              </p>
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────────────── */}
        <section id="pricing" style={{ padding: "72px 0" }}>
          <div data-reveal>
            <div className="kicker">PRICING</div>
            <h2 style={{ fontSize: "clamp(26px,3.4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 40px" }}>
              Pricing that scales with you
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "28px", alignItems: "stretch" }}>
            {/* Platform */}
            <div data-reveal style={{ ...card, padding: "26px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Platform</div>
                <span className="chip">Always included</span>
              </div>
              <div style={{ fontSize: "36px", fontWeight: 700, margin: "10px 0" }}>
                <CountUp to={97} prefix="£" /><span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/month</span>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.5 }}>Your always-on agency operating system.</div>
            </div>

            {/* Starter */}
            <div data-reveal style={{ ...card, padding: "26px", transitionDelay: "60ms" }}>
              <div style={{ fontSize: "13px", color: "var(--text-2)" }}>Starter client</div>
              <div style={{ fontSize: "36px", fontWeight: 700, margin: "10px 0" }}>
                <CountUp to={200} prefix="£" /><span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/client</span>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.5 }}>Calling, booking, and reporting for a single client.</div>
            </div>

            {/* Full service — most popular, gold gradient border */}
            <div data-reveal className="popular-wrap" style={{ transitionDelay: "120ms" }}>
              <div className="popular-inner" style={{ padding: "26px", position: "relative" }}>
                <span className="popular-badge">Most popular</span>
                <div style={{ fontSize: "13px", color: "var(--gold)" }}>Full service</div>
                <div style={{ fontSize: "36px", fontWeight: 700, margin: "10px 0" }}>
                  <CountUp to={500} prefix="£" /><span style={{ fontSize: "14px", color: "var(--text-3)", fontWeight: 400 }}>/client</span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-2)", lineHeight: 1.5 }}>The complete five-role team, fully autonomous.</div>
              </div>
            </div>
          </div>

          {/* Volume discount table */}
          <div data-reveal style={{ ...card, overflow: "hidden" }}>
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
            {/* Worked example */}
            <div style={{ padding: "16px 20px", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-2)" }}>Example — 10 clients</span>
              <span style={{ fontSize: "14px", fontFamily: "var(--font-mono, monospace)", color: "var(--text-1)" }}>
                £97 + (10 × £400) = <span style={{ color: "var(--gold)", fontWeight: 700 }}><CountUp to={4097} prefix="£" />/month</span>
              </span>
            </div>
          </div>
        </section>

        {/* ── Waitlist ───────────────────────────────────────────────────────── */}
        <section id="waitlist" data-reveal style={{ padding: "72px 0 104px", maxWidth: "480px", margin: "0 auto" }}>
          <div className="kicker">EARLY ACCESS</div>
          <h2 style={{ fontSize: "clamp(26px,3.4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", margin: "0 0 8px" }}>
            Request early access
          </h2>
          <p style={{ textAlign: "center", color: "var(--text-2)", fontSize: "15px", margin: "0 0 10px" }}>
            We&apos;re onboarding agencies in waves. Tell us about yours.
          </p>
          <div style={{ textAlign: "center", marginBottom: "22px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <span className="active-dot" />Join <strong style={{ color: "var(--text-1)", fontWeight: 600 }}>47 agencies</strong> on the waitlist
            </span>
          </div>
          <WaitlistForm />
        </section>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <footer style={{ borderTop: "1px solid var(--border)", padding: "28px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ fontWeight: 700, fontSize: "15px" }}>Aurum<span style={{ color: "var(--gold)" }}>.</span></div>
          <div style={{ fontSize: "12px", color: "var(--text-3)" }}>© {new Date().getFullYear()} Aurum Growth OS. Built for agency owners.</div>
        </footer>
      </main>

      {/* ── Styles — all motion is CSS; no npm packages. ─────────────────────── */}
      <style>{`
        /* Sticky header */
        .site-header {
          position: sticky; top: 0; z-index: 50;
          background: transparent; border-bottom: 1px solid transparent;
          transition: background 0.3s ease, backdrop-filter 0.3s ease, border-color 0.3s ease;
        }
        .site-header.scrolled {
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid var(--border);
        }

        /* Gold shimmer CTA */
        .shimmer-btn {
          position: relative; overflow: hidden;
          background: linear-gradient(135deg, #E8C766, var(--gold));
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .shimmer-btn::after {
          content: ""; position: absolute; inset: 0;
          background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%);
          background-size: 220% 100%; background-position: -150% 0; transition: none;
        }
        .shimmer-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 26px -10px var(--gold); }
        .shimmer-btn:hover::after { animation: shimmer 0.9s ease forwards; }
        @keyframes shimmer { from { background-position: 150% 0; } to { background-position: -150% 0; } }

        .ghost-btn { transition: border-color 0.3s ease, background 0.3s ease; }
        .ghost-btn:hover { border-color: var(--text-2); background: rgba(255,255,255,0.03); }

        /* Hero backdrop */
        .dot-grid {
          position: absolute; inset: -10% -10% 0 -10%; z-index: 0; pointer-events: none;
          background-image: radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px);
          background-size: 26px 26px;
          -webkit-mask-image: radial-gradient(ellipse 60% 60% at 50% 38%, #000 0%, transparent 72%);
          mask-image: radial-gradient(ellipse 60% 60% at 50% 38%, #000 0%, transparent 72%);
        }
        .hero-orb {
          position: absolute; top: 36%; left: 50%; width: 680px; height: 680px; z-index: 0;
          transform: translate(-50%,-50%); pointer-events: none; border-radius: 50%;
          background: radial-gradient(circle, rgba(201,168,76,0.30) 0%, rgba(201,168,76,0.10) 38%, transparent 68%);
          filter: blur(20px); animation: orbPulse 7s ease-in-out infinite;
        }
        @keyframes orbPulse {
          0%,100% { opacity: 0.55; transform: translate(-50%,-50%) scale(1); }
          50%     { opacity: 0.9;  transform: translate(-50%,-50%) scale(1.16); }
        }

        /* Hero word-by-word entrance */
        .hero-word { opacity: 0; animation: heroWord 0.75s cubic-bezier(0.2,0.7,0.2,1) both; animation-delay: var(--d); }
        @keyframes heroWord {
          from { opacity: 0; transform: translateY(26px); filter: blur(10px); }
          to   { opacity: 1; transform: none; filter: blur(0); }
        }
        .hero-pill { opacity: 0; animation: heroWord 0.7s ease both; }

        /* Ticker */
        .ticker-wrap {
          border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
          padding: 12px 0; overflow: hidden; position: relative;
          -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
        }
        .ticker-track { display: inline-flex; white-space: nowrap; will-change: transform; animation: ticker 38s linear infinite; }
        .ticker-item {
          font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-3);
          display: inline-flex; align-items: center; gap: 8px; padding: 0 28px;
          border-right: 1px solid var(--border);
        }
        .ticker-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; flex-shrink: 0; }
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }

        /* Section kicker label */
        .kicker {
          text-align: center; font-size: 11px; font-weight: 700; color: var(--gold);
          text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 14px;
        }

        /* Reveal on scroll */
        [data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
        [data-reveal].is-visible { opacity: 1; transform: none; }

        /* Team cards */
        .team-card { position: relative; transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease, opacity 0.6s ease; }
        .team-card:hover {
          transform: translateY(-4px);
          border-color: var(--glow);
          box-shadow: 0 0 0 1px var(--glow), 0 18px 50px -22px var(--glow);
        }
        .active-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-3); }
        .active-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: dotPulse 1.8s ease-in-out infinite; }
        @keyframes dotPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.82); } }

        /* The Moment */
        .moment-bg {
          position: absolute; inset: 0; z-index: 0; pointer-events: none;
          background: radial-gradient(ellipse 80% 120% at 50% 0%, rgba(201,168,76,0.14), transparent 60%);
          animation: momentShift 12s ease-in-out infinite;
        }
        @keyframes momentShift {
          0%,100% { opacity: 0.6; transform: translateY(0); }
          50%     { opacity: 1;   transform: translateY(10px); }
        }
        .gold-em { color: var(--gold); font-weight: 700; }

        /* Pricing chips + popular card */
        .chip { font-size: 10px; font-weight: 600; color: var(--text-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; }
        .popular-wrap {
          border-radius: 13px; padding: 1.5px;
          background: linear-gradient(135deg, #E8C766, var(--gold), #8a6f2e);
          box-shadow: 0 20px 60px -28px var(--gold);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .popular-inner { background: var(--surface-1); border-radius: 12px; height: 100%; }
        .popular-badge {
          position: absolute; top: -11px; right: 18px;
          font-size: 10px; font-weight: 700; color: #000; letter-spacing: 0.04em;
          background: linear-gradient(135deg, #E8C766, var(--gold)); padding: 4px 10px; border-radius: 999px;
          box-shadow: 0 6px 18px -6px var(--gold);
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-orb, .ticker-track, .active-dot, .moment-bg { animation: none !important; }
          .hero-word, .hero-pill { animation: none !important; opacity: 1 !important; }
          [data-reveal] { opacity: 1 !important; transform: none !important; transition: none !important; }
          .shimmer-btn:hover::after { animation: none !important; }
        }
      `}</style>
    </>
  );
}
