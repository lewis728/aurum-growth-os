/**
 * /contractor/[id] — the contractor's dashboard. Auth is the magic-link token
 * (?token=…), not Clerk. Shows only what a contractor cares about: upcoming
 * surveys in their calendar, their charges, their territory + status, and a
 * pause button. No CPL, ad spend, or platform internals.
 */
import { prisma } from "@/lib/prisma";
import { verifyContractorToken } from "@/lib/contractorToken";
import { PauseButton, RequestLinkForm } from "./ClientBits";

export const dynamic = "force-dynamic";

const gold = "var(--gold,#C9A84C)";
const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg,#000)",
  color: "var(--text-1,#fff)",
  fontFamily: "Inter, system-ui, sans-serif",
  padding: "32px 20px",
};
const shell: React.CSSProperties = { maxWidth: 680, margin: "0 auto" };
const cardStyle: React.CSSProperties = {
  background: "var(--surface-1,#0a0a0a)",
  border: "1px solid var(--border,rgba(255,255,255,0.08))",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid var(--border,rgba(255,255,255,0.06))",
};
const muted: React.CSSProperties = { color: "var(--text-2,#a1a1aa)", fontSize: 13 };

function fmtDate(d: Date): string {
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function ContractorDashboard({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token?: string };
}): Promise<React.ReactElement> {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const authed = token ? verifyContractorToken(token) === params.id : false;

  if (!authed) {
    return (
      <main style={page}>
        <div style={{ ...shell, maxWidth: 460 }}>
          <div style={{ fontWeight: 700, color: gold, marginBottom: 20 }}>AURUM</div>
          <div style={cardStyle}>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Your dashboard link has expired</h1>
            <RequestLinkForm />
          </div>
        </div>
      </main>
    );
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id: params.id },
    select: {
      name: true,
      companyName: true,
      city: true,
      vertical: true,
      status: true,
      pricePerSurveyGbp: true,
      lockInFeeGbp: true,
      lockInPaidAt: true,
      prepaidCreditRemaining: true,
    },
  });

  if (!contractor) {
    return (
      <main style={page}>
        <div style={shell}><p>Account not found.</p></div>
      </main>
    );
  }

  const charges = await prisma.surveyCharge.findMany({
    where: { contractorId: params.id },
    include: {
      appointment: {
        select: { scheduledAt: true, status: true, lead: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const upcoming = charges
    .filter((c) => (c.status === "paid" || c.status === "credit_consumed") && c.appointment.scheduledAt > now)
    .sort((a, b) => a.appointment.scheduledAt.getTime() - b.appointment.scheduledAt.getTime());

  const verticalLabel = contractor.vertical === "home_improvement" ? "Home improvement" : "Roofing";
  const statusColor = contractor.status === "active" ? "#22c55e" : contractor.status === "paused" ? "#eab308" : "#52525b";

  return (
    <main style={page}>
      <div style={shell}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontWeight: 700, color: gold }}>AURUM</div>
          <div style={{ ...muted }}>{contractor.companyName ?? contractor.name}</div>
        </div>

        {/* Territory + status */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={muted}>Your territory</div>
              <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{contractor.city}</div>
              <div style={{ ...muted, marginTop: 2 }}>{verticalLabel}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
                {contractor.status}
              </span>
            </div>
          </div>
          {contractor.prepaidCreditRemaining > 0 && (
            <p style={{ ...muted, marginTop: 12 }}>
              {contractor.prepaidCreditRemaining} pre-paid survey{contractor.prepaidCreditRemaining === 1 ? "" : "s"} remaining from your lock-in.
            </p>
          )}
          <div style={{ marginTop: 14 }}>
            {contractor.status === "active" || contractor.status === "paused" ? (
              <PauseButton id={params.id} token={token} initialStatus={contractor.status} />
            ) : (
              <span style={muted}>Complete your lock-in payment to go live.</span>
            )}
          </div>
        </div>

        {/* Upcoming surveys */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Upcoming site surveys</h2>
          <p style={{ ...muted, marginBottom: 8 }}>Confirmed appointments in your calendar.</p>
          {upcoming.length === 0 ? (
            <p style={muted}>No upcoming surveys yet — we&apos;ll call you the moment one is confirmed.</p>
          ) : (
            upcoming.map((c) => (
              <div key={c.id} style={row}>
                <div>
                  <div style={{ fontSize: 15 }}>{`${c.appointment.lead.firstName} ${c.appointment.lead.lastName}`.trim() || "Homeowner"}</div>
                  <div style={muted}>{fmtDate(c.appointment.scheduledAt)}</div>
                </div>
                <span style={{ fontSize: 12, color: gold }}>confirmed</span>
              </div>
            ))
          )}
        </div>

        {/* Charges */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Charges</h2>
          {contractor.lockInPaidAt && (
            <div style={row}>
              <div>
                <div style={{ fontSize: 15 }}>Territory lock-in</div>
                <div style={muted}>{fmtDate(contractor.lockInPaidAt)}</div>
              </div>
              <strong>£{contractor.lockInFeeGbp}</strong>
            </div>
          )}
          {charges.map((c) => (
            <div key={c.id} style={row}>
              <div>
                <div style={{ fontSize: 15 }}>Site survey booking</div>
                <div style={muted}>{fmtDate(c.createdAt)}{c.status === "failed" ? " · payment failed" : c.status === "pending" ? " · pending" : ""}</div>
              </div>
              <strong style={{ color: c.status === "failed" ? "#f87171" : undefined }}>
                {c.kind === "credit" ? "£0 (pre-paid)" : `£${c.amountGbp}`}
              </strong>
            </div>
          ))}
          {charges.length === 0 && !contractor.lockInPaidAt && <p style={muted}>No charges yet.</p>}
        </div>
      </div>
    </main>
  );
}
