/**
 * src/lib/agents/chiefOfStaff.ts
 * SERVER-SIDE ONLY.
 *
 * The Chief of Staff — a single cross-portfolio agent per agency (tenant). Unlike
 * the per-client account managers, it sees ALL clients and thinks like a COO:
 * spotting patterns, flagging at-risk clients, surfacing upsell opportunities, and
 * briefing the agency owner on what matters most today.
 *
 * Writes portfolio-level AgentActions (blueprintId = null, tenant-scoped only):
 *   PORTFOLIO_BRIEFING | CLIENT_AT_RISK | UPSELL_OPPORTUNITY | PORTFOLIO_INSIGHT
 *
 * Never throws — failures are logged so the cron settles cleanly.
 */
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

const CHIEF_OF_STAFF_NAME = "Chief of Staff";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type AlertType = "CLIENT_AT_RISK" | "UPSELL_OPPORTUNITY" | "PORTFOLIO_INSIGHT";
const ALERT_TYPES = new Set<AlertType>(["CLIENT_AT_RISK", "UPSELL_OPPORTUNITY", "PORTFOLIO_INSIGHT"]);

interface PortfolioAnalysis {
  briefing: string;
  alerts:   Array<{ type: AlertType; clientName: string; message: string }>;
}

export async function runChiefOfStaffCycle(tenantId: string): Promise<void> {
  try {
    const since = new Date(Date.now() - ONE_DAY_MS);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // ── Portfolio context ─────────────────────────────────────────────────────
    const [agency, blueprints, recentActions] = await Promise.all([
      prisma.agencyProfile.findUnique({
        where:  { tenantId },
        select: { agencyName: true, chiefOfStaffBrief: true, targetClientsPerMonth: true, agencyAverageClientValue: true },
      }),
      prisma.campaignBlueprint.findMany({
        where:  { tenantId },
        select: { id: true, businessName: true, vertical: true, status: true, dailyBudgetUsd: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.agentAction.findMany({
        where:   { tenantId, executedAt: { gte: since } },
        orderBy: { executedAt: "desc" },
        take:    50,
      }),
    ]);

    if (blueprints.length === 0) return; // nothing to brief on

    const agencyName = agency?.agencyName ?? "your agency";
    const blueprintIds = blueprints.map(b => b.id);

    // Today's leads + appointments per client.
    const [leadsByClient, apptsByClient] = await Promise.all([
      prisma.lead.groupBy({
        by:     ["blueprintId"],
        where:  { tenantId, blueprintId: { in: blueprintIds }, createdAt: { gte: startOfToday } },
        _count: { id: true },
      }),
      prisma.appointment.groupBy({
        by:     ["blueprintId"],
        where:  { tenantId, blueprintId: { in: blueprintIds }, createdAt: { gte: startOfToday } },
        _count: { id: true },
      }),
    ]);

    const leadMap = new Map<string, number>();
    for (const g of leadsByClient) if (g.blueprintId) leadMap.set(g.blueprintId, g._count.id);
    const apptMap = new Map<string, number>();
    for (const g of apptsByClient) if (g.blueprintId) apptMap.set(g.blueprintId, g._count.id);

    const clientLines = blueprints.map(b =>
      `  • ${b.businessName} (${b.vertical}): status=${b.status}, budget=£${b.dailyBudgetUsd}/day, ` +
      `leads today=${leadMap.get(b.id) ?? 0}, appts today=${apptMap.get(b.id) ?? 0}`
    ).join("\n");

    const actionLines = recentActions.length === 0
      ? "No agent actions in the last 24 hours."
      : recentActions
          .map(a => {
            const bpName = a.blueprintId
              ? (blueprints.find(b => b.id === a.blueprintId)?.businessName ?? "a client")
              : "portfolio";
            return `  • [${a.actionType}] ${bpName}: ${a.reasoning.slice(0, 140)}`;
          })
          .join("\n");

    const totalLeadsToday = Array.from(leadMap.values()).reduce((s, n) => s + n, 0);
    const totalApptsToday = Array.from(apptMap.values()).reduce((s, n) => s + n, 0);

    if (!process.env.OPENAI_API_KEY) {
      console.error("[chiefOfStaff] OPENAI_API_KEY not set — skipping");
      return;
    }

    // ── GPT-4o portfolio reasoning ────────────────────────────────────────────
    const systemPrompt =
      `You are the agency chief of staff for ${agencyName}. You have visibility across ALL clients. ` +
      `You think like a COO. You spot patterns, flag risks, identify opportunities, and brief the ` +
      `agency owner on what matters most today. ` +
      (agency?.chiefOfStaffBrief ? `\nAgency owner's standing brief: ${agency.chiefOfStaffBrief}\n` : "") +
      `\nAnalyse: overall portfolio health; any clients at risk (e.g. repeated PAUSE_CAMPAIGN actions, ` +
      `CPL flagged 2x+ benchmark across cycles, zero leads on live budget); any clients ready for budget ` +
      `scaling; and cross-client patterns.\n\n` +
      `Respond ONLY as JSON: {"briefing": string, "alerts": [{"type": "CLIENT_AT_RISK"|"UPSELL_OPPORTUNITY"|"PORTFOLIO_INSIGHT", "clientName": string, "message": string}]}. ` +
      `The briefing is 2-4 first-person sentences for the owner. Include 0-5 alerts — only genuinely ` +
      `actionable ones. clientName must match a client name exactly, or "portfolio" for cross-client items.`;

    const userPrompt =
      `Portfolio snapshot for ${agencyName}:\n` +
      `  Clients: ${blueprints.length}\n` +
      `  Total leads today: ${totalLeadsToday}\n` +
      `  Total appointments today: ${totalApptsToday}\n\n` +
      `Clients:\n${clientLines}\n\nAgent actions (last 24h):\n${actionLines}`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      temperature:     0.5,
      max_tokens:      900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let analysis: PortfolioAnalysis;
    try {
      const parsed = JSON.parse(raw) as Partial<PortfolioAnalysis>;
      analysis = {
        briefing: typeof parsed.briefing === "string" ? parsed.briefing : "",
        alerts:   Array.isArray(parsed.alerts) ? parsed.alerts : [],
      };
    } catch {
      console.error("[chiefOfStaff] failed to parse GPT JSON");
      return;
    }

    // ── Persist portfolio-level actions (blueprintId = null) ──────────────────
    const records: { actionType: string; reasoning: string; outcome: string }[] = [];

    if (analysis.briefing.trim()) {
      records.push({ actionType: "PORTFOLIO_BRIEFING", reasoning: analysis.briefing.trim(), outcome: "Briefed" });
    }
    for (const alert of analysis.alerts) {
      if (!alert || typeof alert.message !== "string" || !alert.message.trim()) continue;
      const type: AlertType = ALERT_TYPES.has(alert.type) ? alert.type : "PORTFOLIO_INSIGHT";
      const prefix = alert.clientName && alert.clientName !== "portfolio" ? `${alert.clientName}: ` : "";
      records.push({ actionType: type, reasoning: `${prefix}${alert.message.trim()}`, outcome: "Flagged" });
    }

    if (records.length > 0) {
      await prisma.agentAction.createMany({
        data: records.map(r => ({
          tenantId,
          blueprintId: null,
          agentName:   CHIEF_OF_STAFF_NAME,
          actionType:  r.actionType,
          reasoning:   r.reasoning,
          outcome:     r.outcome,
        })),
      });
    }
  } catch (err) {
    console.error(`[chiefOfStaff] cycle failed for tenant ${tenantId}:`, err instanceof Error ? err.message : err);
  }
}
