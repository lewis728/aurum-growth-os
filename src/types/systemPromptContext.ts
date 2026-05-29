/**
 * src/types/systemPromptContext.ts
 *
 * Defines the SystemPromptContext interface — the live data payload injected
 * into the Aurum system prompt for every chat session.
 *
 * SERVER-SIDE ONLY. Never import in "use client" files.
 */

export interface CampaignSummary {
  /** Human-readable campaign name, e.g. "Manchester Dental Implants" */
  displayName: string;
  /** CampaignStatus enum value, e.g. "LIVE", "PAUSED", "PENDING" */
  status: string;
  /** Number of leads generated this week for this campaign */
  leadsThisWeek?: number;
  /** Cost-per-lead this week in GBP */
  cplThisWeek?: number;
  /** Total ad spend this week in GBP */
  spend?: number;
  /** Click-through rate as a decimal, e.g. 0.012 = 1.2% */
  ctr?: number;
}

export interface VerticalKnowledge {
  /** CPL benchmark in GBP from the VerticalProfile library */
  cplBenchmarkGbp: number;
  /** Recommended creative style, e.g. "before/after, transformation-led" */
  creativeStyle: string;
  /** Bid strategy guidance for this vertical */
  bidStrategyNotes: string;
  /** Audience targeting notes for this vertical */
  audienceNotes: string;
}

export interface SystemPromptContext {
  /** Clerk organisation name — the marketing agency name */
  tenantName: string;
  /**
   * Display names of all active service verticals across the agency's portfolio.
   * e.g. ["Cosmetic Dental", "Aesthetics", "Personal Injury Law"]
   */
  activeVerticals: string[];
  /**
   * Performance snapshot for every campaign in the agency's portfolio.
   * Rendered as a per-client table in the live context section.
   */
  existingCampaigns: CampaignSummary[];
  /** Total leads generated across all clients this calendar month */
  totalLeadsThisMonth?: number;
  /** Display name of the best-performing client campaign this month */
  topPerformingService?: string;
  /**
   * Live vertical intelligence from the VerticalProfile library.
   * Injected when the current conversation context has a clear vertical signal.
   */
  verticalKnowledge?: VerticalKnowledge;
  /**
   * Active performance alerts across the agency portfolio.
   * Rendered as priority items at the top of the live context section.
   * e.g. ["ALERT: Manchester dental CPL £68 — 13% above benchmark for day 5"]
   */
  performanceAlerts?: string[];
  /**
   * Budget utilisation for today across all live campaigns (0.0–1.0).
   * 0.0 = no spend yet today, 1.0 = daily budget fully consumed.
   */
  budgetUtilisation?: number;
}
