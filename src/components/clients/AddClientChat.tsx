"use client";
/**
 * src/components/clients/AddClientChat.tsx
 * CLIENT-SIDE ONLY.
 *
 * Full-screen chat interface for adding a new client to the agency workspace.
 * Mirrors the OnboardingChat design but with client-focused copy.
 *
 * On completion: emits onClientAdded(blueprintId, businessName) callback.
 */

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface AddClientChatProps {
  onClientAdded?: (blueprintId: string, businessName: string) => void;
  onCancel?: () => void;
}

const WELCOME_MESSAGE =
  "Let's add your next client. Five quick questions and their campaign is ready to configure.";

const FIRST_QUESTION =
  "Let's add your client. What's the name of their business and what do they do?";

const TOTAL_QUESTIONS = 5;

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-stone-500 tracking-wide uppercase">
          Question {current} of {total}
        </span>
        <span className="text-xs font-medium text-amber-600">{pct}%</span>
      </div>
      <div className="h-1 w-full bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center mr-3 mt-0.5">
          <span className="text-white text-xs font-bold">A</span>
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-stone-900 text-white rounded-br-sm"
            : "bg-white border border-stone-100 text-stone-800 rounded-bl-sm shadow-sm"
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 bg-amber-500 ml-0.5 animate-pulse align-middle" />
          )}
        </p>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center ml-3 mt-0.5">
          <span className="text-stone-600 text-xs font-bold">You</span>
        </div>
      )}
    </div>
  );
}

function CompletionBanner({ businessName }: { businessName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-stone-800 mb-2">
        {businessName} added
      </h3>
      <p className="text-sm text-stone-500">
        Taking you to their campaign dashboard…
      </p>
      <div className="mt-4 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function AddClientChat({ onClientAdded, onCancel }: AddClientChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, timestamp: new Date().toISOString() },
    { id: "q1", role: "assistant", content: FIRST_QUESTION, timestamp: new Date().toISOString() },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [isComplete, setIsComplete] = useState(false);
  const [completedBusinessName, setCompletedBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming || isComplete) return;

    setError(null);
    setInputValue("");

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "", timestamp: new Date().toISOString() },
    ]);
    setIsStreaming(true);
    setStreamingMessageId(assistantMsgId);

    const historyForApi = messages
      .filter((m) => m.content.trim() !== "")
      .map((m) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp }));

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch("/api/clients/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: historyForApi }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let event: Record<string, unknown>;
          try { event = JSON.parse(jsonStr) as Record<string, unknown>; }
          catch { continue; }

          switch (event["type"] as string) {
            case "text": {
              const chunk = event["content"] as string;
              setMessages((prev) =>
                prev.map((m) => m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m)
              );
              break;
            }
            case "question_number":
              setCurrentQuestion(event["number"] as number);
              break;
            case "client_added": {
              const blueprintId = event["blueprintId"] as string;
              const businessName = event["businessName"] as string;
              setIsComplete(true);
              setIsStreaming(false);
              setStreamingMessageId(null);
              setCompletedBusinessName(businessName);
              setMessages((prev) =>
                prev.filter((m) => !(m.id === assistantMsgId && m.content === ""))
              );
              setTimeout(() => {
                if (onClientAdded) {
                  onClientAdded(blueprintId, businessName);
                } else {
                  window.location.href = `/campaigns/${blueprintId}`;
                }
              }, 2000);
              return;
            }
            case "error": {
              setError(event["message"] as string);
              setMessages((prev) =>
                prev.filter((m) => !(m.id === assistantMsgId && m.content === ""))
              );
              break;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
      setMessages((prev) => prev.filter((m) => !(m.id === assistantMsgId && m.content === "")));
    } finally {
      setIsStreaming(false);
      setStreamingMessageId(null);
    }
  }, [inputValue, isStreaming, isComplete, messages, onClientAdded]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-stone-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-stone-100 px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-amber-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold tracking-tight">A</span>
                </div>
                <span className="text-sm font-semibold text-stone-800 tracking-tight">Aurum</span>
              </div>
              <span className="text-stone-300">·</span>
              <h1 className="text-sm font-medium text-stone-600">Add a client</h1>
            </div>
            <div className="flex items-center gap-3">
              {!isComplete && (
                <span className="text-xs text-stone-400">{currentQuestion} / {TOTAL_QUESTIONS}</span>
              )}
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="text-xs text-stone-400 hover:text-stone-600 transition"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          {!isComplete && <ProgressBar current={currentQuestion} total={TOTAL_QUESTIONS} />}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && msg.id === streamingMessageId}
            />
          ))}
          {isComplete && <CompletionBanner businessName={completedBusinessName} />}
          {error && (
            <div className="flex justify-center mb-4">
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 max-w-sm text-center">
                <p className="text-sm text-red-600 mb-2">{error}</p>
                <button onClick={() => setError(null)} className="text-xs text-red-500 underline hover:no-underline">
                  Try again
                </button>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      {!isComplete && (
        <div className="flex-shrink-0 bg-white border-t border-stone-100 px-4 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-end gap-3 bg-stone-50 rounded-2xl border border-stone-200 px-4 py-3 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-100 transition-all">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer…"
                rows={1}
                disabled={isStreaming}
                className="flex-1 bg-transparent text-sm text-stone-800 placeholder-stone-400 resize-none outline-none leading-relaxed disabled:opacity-50"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!inputValue.trim() || isStreaming}
                className="flex-shrink-0 w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-2 text-center">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
