"use client";

/**
 * NotificationsConfig — agency owner pastes their Slack Incoming Webhook URL so
 * their AI team can escalate alerts (client at risk, approval needed, Meta down).
 *
 * The saved URL is a secret and is never returned by the API — we only show
 * whether one is configured. "Save & test" sends a real test message first.
 */

import { useState, useEffect } from "react";

interface Status { slackConfigured: boolean }

export function NotificationsConfig() {
  const [configured, setConfigured] = useState(false);
  const [url, setUrl]               = useState("");
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/agency/notifications")
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.resolve({ slackConfigured: false })))
      .then((d) => setConfigured(d.slackConfigured))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  async function save(test: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agency/notifications", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ slackWebhookUrl: url, test }),
      });
      const data = (await res.json()) as { slackConfigured?: boolean; tested?: boolean; error?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not save." });
      } else {
        setConfigured(Boolean(data.slackConfigured));
        setUrl("");
        setMsg({ kind: "ok", text: data.tested ? "Saved — test message sent to Slack." : "Saved." });
      }
    } catch {
      setMsg({ kind: "err", text: "Network error — try again." });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/agency/notifications", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ slackWebhookUrl: "" }),
      });
      if (res.ok) { setConfigured(false); setMsg({ kind: "ok", text: "Slack disconnected." }); }
      else setMsg({ kind: "err", text: "Could not disconnect." });
    } catch {
      setMsg({ kind: "err", text: "Network error — try again." });
    } finally {
      setSaving(false);
    }
  }

  const canSave = /^https:\/\/hooks\.slack\.com\//.test(url.trim()) && !saving;

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-bold text-[#111827] tracking-tight">Slack alerts</h2>
      <p className="text-xs text-[#6B7280] mt-0.5 mb-4">
        Your AI team messages you here when something needs a human — a client at risk, a
        spend change awaiting approval, or Meta delivery dropping.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: configured ? "#22c55e" : "#9ca3af" }}
        />
        <span className="text-sm text-[#374151]">
          {loading ? "Checking…" : configured ? "Slack connected" : "Not connected"}
        </span>
      </div>

      <label className="block text-xs font-medium text-[#374151] mb-1">
        Slack Incoming Webhook URL
      </label>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://hooks.slack.com/services/T000/B000/xxxx"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#C9A84C] focus:outline-none"
      />
      <p className="text-[11px] text-[#9CA3AF] mt-1">
        Create one at api.slack.com → Your Apps → Incoming Webhooks. Paste it here.
      </p>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => save(true)}
          disabled={!canSave}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "#C9A84C" }}
        >
          {saving ? "Saving…" : "Save & send test"}
        </button>
        <button
          onClick={() => save(false)}
          disabled={!canSave}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#374151] disabled:opacity-40"
        >
          Save without test
        </button>
        {configured && (
          <button
            onClick={disconnect}
            disabled={saving}
            className="ml-auto rounded-lg px-3 py-2 text-sm text-[#b91c1c] disabled:opacity-40"
          >
            Disconnect
          </button>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
