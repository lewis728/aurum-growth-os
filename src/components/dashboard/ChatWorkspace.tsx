"use client";
/**
 * src/components/dashboard/ChatWorkspace.tsx
 * The Command Center — main chat interface for Aurum Growth OS.
 * Handles SSE streaming from /api/chat, renders messages, and triggers
 * DeploymentTracker when a launch_event is received.
 *
 * CLIENT-SIDE ONLY. Never import Prisma, OpenAI, Twilio, or Retell here.
 */
import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from "react";
import { useChatStore }  from "@/stores/chatStore";
import DeploymentTracker from "./DeploymentTracker";

// ── Suggestion chips ──────────────────────────────────────────────────────────
const SUGGESTION_CHIPS = [
  "Launch aesthetics campaign in Manchester",
  "Start a dental implants funnel in London",
  "Run personal injury law ads in Birmingham",
  "Set up HVAC installation campaign in Leeds",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour:   "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChatWorkspace(): JSX.Element {
  const {
    messages,
    isStreaming,
    sessionId,
    activeBlueprintId,
    error,
    addMessage,
    setIsStreaming,
    setActiveBlueprintId,
    setError,
    clearSession,
  } = useChatStore();

  const [inputValue, setInputValue]     = useState("");
  const [streamBuffer, setStreamBuffer] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef       = useRef<AbortController | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [inputValue]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    const userMsg = {
      id:        generateId(),
      role:      "user" as const,
      content:   trimmed,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);
    setInputValue("");
    setStreamBuffer("");
    setIsStreaming(true);
    setError(null);

    const history = messages.slice(-20).map((m) => ({
      role:    m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/api/chat", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ message: trimmed, history, sessionId }),
        signal:      abortRef.current.signal,
        credentials: "include",
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(errText);
      }

      if (!res.body) throw new Error("No response body");

      const reader      = res.body.getReader();
      const decoder     = new TextDecoder();
      let   buf         = "";
      let   accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          const eventType = parsed.type as string | undefined;

          if (eventType === "text" || eventType === "delta") {
            const chunk = (parsed.content ?? parsed.delta ?? "") as string;
            accumulated += chunk;
            setStreamBuffer(accumulated);
          } else if (eventType === "launch_event") {
            const blueprintId = parsed.blueprintId as string | undefined;
            if (blueprintId) {
              setActiveBlueprintId(blueprintId);
            }
          } else if (eventType === "error") {
            const errMsg = (parsed.message ?? "An error occurred") as string;
            setError(errMsg);
          } else if (eventType === "done") {
            if (accumulated.trim()) {
              addMessage({
                id:        generateId(),
                role:      "assistant",
                content:   accumulated,
                timestamp: new Date().toISOString(),
              });
            }
            accumulated = "";
            setStreamBuffer("");
          }
        }
      }

      if (accumulated.trim()) {
        addMessage({
          id:        generateId(),
          role:      "assistant",
          content:   accumulated,
          timestamp: new Date().toISOString(),
        });
        setStreamBuffer("");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      addMessage({
        id:        generateId(),
        role:      "assistant",
        content:   `Something went wrong: ${msg}. Please try again.`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsStreaming(false);
      setStreamBuffer("");
      abortRef.current = null;
    }
  }, [
    isStreaming,
    sessionId,
    messages,
    addMessage,
    setIsStreaming,
    setActiveBlueprintId,
    setError,
  ]);

  // ── Keyboard handler ─────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(inputValue);
      }
    },
    [inputValue, sendMessage]
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  const isEmpty = messages.length === 0 && !streamBuffer;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Command Centre</h2>
          <p className="text-xs text-gray-400 mt-0.5">Describe a campaign in plain English</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearSession}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-50"
          >
            New session
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6" style={{ color: "#C9A84C" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <p className="text-base font-medium text-gray-900 max-w-xs leading-snug">
              I&apos;m Aurum. Your autonomous marketing system.
            </p>
            <p className="text-sm text-gray-400 mt-1 max-w-xs">
              Tell me what you want to build.
            </p>
            <div className="mt-6 flex flex-col gap-2 w-full max-w-sm">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => void sendMessage(chip)}
                  className="text-left text-sm text-gray-600 bg-gray-50 hover:bg-amber-50 hover:text-amber-800 border border-gray-200 hover:border-amber-200 rounded-xl px-4 py-2.5 transition-all duration-150"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center mt-0.5">
                    <span className="text-xs font-bold" style={{ color: "#C9A84C" }}>A</span>
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-gray-900 text-white rounded-br-sm"
                      : "bg-gray-50 text-gray-800 rounded-bl-sm border border-gray-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-xs mt-1.5 text-gray-400">{formatTime(msg.timestamp)}</p>
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center mt-0.5">
                    <span className="text-xs font-medium text-white">Y</span>
                  </div>
                )}
              </div>
            ))}

            {streamBuffer && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center mt-0.5">
                  <span className="text-xs font-bold" style={{ color: "#C9A84C" }}>A</span>
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed bg-gray-50 text-gray-800 border border-gray-100">
                  <p className="whitespace-pre-wrap">{streamBuffer}</p>
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm" style={{ backgroundColor: "#C9A84C" }} />
                </div>
              </div>
            )}

            {isStreaming && !streamBuffer && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                  <span className="text-xs font-bold" style={{ color: "#C9A84C" }}>A</span>
                </div>
                <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-gray-50 border border-gray-100">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {activeBlueprintId && (
          <div>
            <DeploymentTracker blueprintId={activeBlueprintId} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-end gap-2 bg-gray-50 rounded-2xl border border-gray-200 focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-100 transition-all px-4 py-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a campaign to launch…"
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 resize-none outline-none py-1.5 min-h-[36px] max-h-[160px] disabled:opacity-50"
          />
          <button
            onClick={() => void sendMessage(inputValue)}
            disabled={!inputValue.trim() || isStreaming}
            aria-label="Send message"
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-gray-900 hover:bg-gray-700 disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-colors mb-0.5"
          >
            {isStreaming ? (
              <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
