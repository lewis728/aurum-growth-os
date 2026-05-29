/**
 * src/lib/services/landingPageService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Deploys landing pages via Vercel API.
 * Every external call is wrapped in withRetry() per GR-02.
 */

import { withRetry } from "@/lib/utils/withRetry";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";

const VERCEL_API_BASE = "https://api.vercel.com";

function getVercelToken(): string {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_API_TOKEN is not configured");
  return token;
}

function getVercelTeamId(): string | undefined {
  return process.env.VERCEL_TEAM_ID;
}

export interface DeployedPage {
  deploymentId: string;
  liveUrl: string;
  projectName: string;
  deployedAt: Date;
  status: "live" | "building" | "error";
}

interface VercelDeploymentResponse {
  id: string;
  url: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  name: string;
  createdAt: number;
}

/**
 * Generates the HTML content for the landing page based on the blueprint.
 */
function generateLandingPageHtml(blueprint: CampaignBlueprint): string {
  const deployment = blueprint.deploymentLayer;
  const copy = deployment.copy;
  const headline = copy.heroHeadline ?? "Book Your Free Consultation";
  const subheadline = copy.heroSubheadline ?? "Speak with a specialist today";
  const formHeading = copy.formHeading ?? "Get Your Free Consultation";
  const webhookEndpoint = deployment.webhookEndpoint;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${headline}</title>
  <meta name="description" content="${subheadline}" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a1a1a; }
    .hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%); color: #fff; }
    h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; line-height: 1.1; margin-bottom: 1rem; }
    .sub { font-size: clamp(1rem, 2.5vw, 1.4rem); opacity: 0.85; margin-bottom: 2.5rem; max-width: 600px; }
    form { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; width: 100%; max-width: 480px; }
    h2 { color: #fff; margin-bottom: 1.5rem; font-size: 1.3rem; }
    input { width: 100%; padding: 0.875rem 1rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.08); color: #fff; font-size: 1rem; margin-bottom: 1rem; }
    input::placeholder { color: rgba(255,255,255,0.5); }
    button { width: 100%; padding: 1rem; background: #6c63ff; color: #fff; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 700; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #5a52e0; }
    .success { display: none; color: #4ade80; font-size: 1.1rem; margin-top: 1rem; }
    .disclaimer { font-size: 0.75rem; opacity: 0.5; margin-top: 1rem; }
  </style>
</head>
<body>
  <section class="hero">
    <h1>${headline}</h1>
    <p class="sub">${subheadline}</p>
    <form id="leadForm">
      <h2>${formHeading}</h2>
      <input type="text" name="name" placeholder="Your full name" required />
      <input type="tel" name="phone" placeholder="Your phone number" required />
      <input type="email" name="email" placeholder="Your email address" required />
      <button type="submit">Book My Free Consultation</button>
      <p class="success" id="successMsg">Thank you! We'll be in touch shortly.</p>
    </form>
    <p class="disclaimer">${copy.footerDisclaimer ?? ""}</p>
  </section>
  <script>
    document.getElementById('leadForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(this));
      try {
        await fetch('${webhookEndpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, blueprintId: '${blueprint.blueprintId}', source: 'landing_page' })
        });
        document.getElementById('successMsg').style.display = 'block';
        this.reset();
      } catch (err) {
        alert('Something went wrong. Please try again.');
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Deploys a landing page for the given blueprint via Vercel API.
 * Returns a DeployedPage with the live URL populated.
 */
export async function deployLandingPage(blueprint: CampaignBlueprint): Promise<DeployedPage> {
  const token = getVercelToken();
  const teamId = getVercelTeamId();

  const projectName = `aurum-${blueprint.blueprintId.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  const htmlContent = generateLandingPageHtml(blueprint);

  const deploymentBody: Record<string, unknown> = {
    name: projectName,
    files: [
      {
        file: "index.html",
        data: Buffer.from(htmlContent).toString("base64"),
        encoding: "base64",
      },
    ],
    projectSettings: { framework: null },
    target: "production",
  };

  if (teamId) deploymentBody.teamId = teamId;

  const deployment = await withRetry(
    async () => {
      const res = await fetch(`${VERCEL_API_BASE}/v13/deployments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(deploymentBody),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(
          `Vercel deployment failed for blueprint ${blueprint.blueprintId}: HTTP ${res.status} — ${err.error?.message ?? "unknown error"}`
        );
      }

      return (await res.json()) as VercelDeploymentResponse;
    },
    { maxAttempts: 3, baseDelayMs: 1_000, label: "landingPageService.deployLandingPage" }
  );

  return {
    deploymentId: deployment.id,
    liveUrl: `https://${deployment.url}`,
    projectName,
    deployedAt: new Date(deployment.createdAt),
    status: deployment.readyState === "READY" ? "live" : "building",
  };
}
