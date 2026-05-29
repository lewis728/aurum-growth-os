"use client";
/**
 * src/stores/chatStore.ts
 * CLIENT-SIDE ONLY. Never import server-only modules here.
 *
 * Zustand store managing the Aurum Command Center chat session.
 * Single source of truth for messages, streaming state, and active blueprint.
 */

import { create } from "zustand";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";

// ── Store shape ───────────────────────────────────────────────────────────────

interface ChatState {
  /** All messages in the current session, in chronological order. */
  messages: ChatMessage[];

  /** True while an SSE stream is active and receiving tokens. */
  isStreaming: boolean;

  /**
   * Stable session ID generated once on store initialisation.
   * Sent with every /api/chat request for server-side deduplication.
   */
  sessionId: string;

  /**
   * Set when a launch_event SSE message is received.
   * Used by useOrchestrationStatus to open the status SSE connection.
   */
  activeBlueprintId: string | null;

  /** Last error message from the SSE stream or a failed action. */
  error: string | null;
}

interface ChatActions {
  /** Append a message to the session. */
  addMessage: (message: ChatMessage) => void;

  /** Toggle the streaming indicator. */
  setIsStreaming: (value: boolean) => void;

  /** Set the active blueprint ID after a successful campaign launch. */
  setActiveBlueprintId: (id: string | null) => void;

  /** Set or clear the error string. */
  setError: (error: string | null) => void;

  /**
   * Reset the session: clears messages, activeBlueprintId, and error.
   * Generates a fresh sessionId so the server treats this as a new session.
   */
  clearSession: () => void;
}

type ChatStore = ChatState & ChatActions;

// ── Session ID generator ──────────────────────────────────────────────────────

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set) => ({
  // Initial state
  messages:          [],
  isStreaming:       false,
  sessionId:         generateSessionId(),
  activeBlueprintId: null,
  error:             null,

  // Actions
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setIsStreaming: (value) =>
    set({ isStreaming: value }),

  setActiveBlueprintId: (id) =>
    set({ activeBlueprintId: id }),

  setError: (error) =>
    set({ error }),

  clearSession: () =>
    set({
      messages:          [],
      activeBlueprintId: null,
      error:             null,
      isStreaming:       false,
      sessionId:         generateSessionId(),
    }),
}));
