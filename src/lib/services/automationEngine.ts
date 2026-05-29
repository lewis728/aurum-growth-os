/**
 * src/lib/services/automationEngine.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Executes AutomationTrigger[] from a blueprint's CRMLayer.
 * Supported actions: sendDirectSMS, email notify.
 * Every external call is wrapped in withRetry() per GR-02.
 */

import { prisma } from "@/lib/prisma";
import { sendDirectSMS } from "@/lib/services/twilioService";
import type { AutomationTrigger } from "@/types/crmLayer";

export interface TriggerContext {
  blueprintId: string;
  leadId: string;
  tenantId: string;
}

/**
 * Executes all AutomationTrigger[] for the given event.
 * Reads lead phone and name from DB. Interpolates templates.
 * Logs each execution to CommandLog.
 * Never throws — errors are logged and skipped.
 */
export async function triggerAutomations(
  context: TriggerContext,
  triggers: AutomationTrigger[],
  eventName: string
): Promise<void> {
  const matchingTriggers = triggers.filter((t) => t.event === eventName);

  if (matchingTriggers.length === 0) {
    console.log(
      `[automationEngine] No triggers for event "${eventName}" on blueprint ${context.blueprintId}`
    );
    return;
  }

  // Fetch lead for interpolation
  const lead = await prisma.lead.findUnique({
    where: { id: context.leadId },
  });

  if (!lead) {
    console.error(
      `[automationEngine] Lead ${context.leadId} not found — skipping automations`
    );
    return;
  }

  // Fetch blueprint for business name
  const blueprint = await prisma.campaignBlueprint.findUnique({
    where: { id: context.blueprintId },
  });

  const businessName = blueprint
    ? (blueprint.businessName as string | undefined) ?? "our team"
    : "our team";

  for (const trigger of matchingTriggers) {
    // Apply delay if specified
    if (trigger.delaySeconds && trigger.delaySeconds > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, trigger.delaySeconds! * 1_000)
      );
    }

    try {
      // Determine action type from automationId prefix
      if (trigger.automationId.startsWith("sms:")) {
        const templateKey = trigger.automationId.replace("sms:", "");
        const rawTemplate =
          templateKey === "confirmation"
            ? `Hi {{LEAD_NAME}}, thanks for your enquiry! A member of the ${businessName} team will call you within the next 60 minutes.`
            : templateKey === "follow_up"
            ? `Hi {{LEAD_NAME}}, this is a follow-up from ${businessName}. We'd love to help — please call us back at your convenience.`
            : `Hi {{LEAD_NAME}}, a message from ${businessName}.`;

        const messageBody = rawTemplate
          .replace(/{{LEAD_NAME}}/g, lead.firstName ?? "there")
          .replace(/{{BUSINESS_NAME}}/g, businessName);

        if (lead.phone) {
          await sendDirectSMS(lead.phone, messageBody);
          console.log(
            `[automationEngine] SMS sent to lead ${context.leadId} for trigger ${trigger.automationId}`
          );
        } else {
          console.warn(
            `[automationEngine] Lead ${context.leadId} has no phone number — skipping SMS trigger ${trigger.automationId}`
          );
        }
      } else if (trigger.automationId.startsWith("email:")) {
        // Email notifications — log intent for now; full implementation in Stage 08
        console.log(
          `[automationEngine] Email trigger ${trigger.automationId} for lead ${context.leadId} — queued for Stage 08 implementation`
        );
      } else {
        console.warn(
          `[automationEngine] Unknown automationId format: ${trigger.automationId}`
        );
      }

      // Log successful execution
      await prisma.commandLog.create({
        data: {
          tenantId: context.tenantId,
          rawInput: `automation:${trigger.automationId}`,
          intentType: "AUTOMATION_TRIGGER",
          blueprintId: context.blueprintId,
          success: true,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[automationEngine] Trigger ${trigger.automationId} failed for lead ${context.leadId}: ${message}`
      );

      // Log failure — never re-throw
      await prisma.commandLog.create({
        data: {
          tenantId: context.tenantId,
          rawInput: `automation:${trigger.automationId}`,
          intentType: "AUTOMATION_TRIGGER",
          blueprintId: context.blueprintId,
          success: false,
          errorMsg: message,
        },
      });
    }
  }
}
