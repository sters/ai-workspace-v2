"use client";

import useSWR from "swr";
import type { ChatSessionInfo } from "@/types/chat";
import { fetcher } from "@/lib/api";

/**
 * What an open chat session is doing. `unknown` is what a chat server that
 * predates the `busy` field reports — the session is open and nothing can be
 * said about it, which is not the same claim as "waiting".
 */
export type ChatActivity = "busy" | "waiting" | "unknown";

/**
 * Polled far faster than the running-operations list' 10s: a chat flips between
 * working and waiting at the pace of one turn, where an operation runs for
 * minutes. The poll is the dominant term in how long the indicator lags the
 * session — a busy→waiting flip costs `CHAT_BUSY_IDLE_MS` plus one interval —
 * and it is affordable at this cadence because the request reaches an
 * in-memory map over localhost.
 */
const REFRESH_INTERVAL_MS = 2000;

function activityOf(session: ChatSessionInfo): ChatActivity {
  if (session.busy === undefined) return "unknown";
  return session.busy ? "busy" : "waiting";
}

/** Loudest activity wins when one workspace holds several sessions. */
const ACTIVITY_RANK: Record<ChatActivity, number> = {
  busy: 2,
  waiting: 1,
  unknown: 0,
};

/**
 * Live chat sessions, reduced to one activity per workspace.
 *
 * A workspace can hold more than one session (a review chat alongside the main
 * one), and `busy` wins — the question the indicator answers is whether
 * anything is working there, not whether everything is.
 */
export function useChatSessions() {
  const { data, mutate } = useSWR<ChatSessionInfo[]>(
    "/api/chat-sessions",
    fetcher,
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  const sessions = data ?? [];
  const chatActivity = new Map<string, ChatActivity>();
  for (const session of sessions) {
    const next = activityOf(session);
    const current = chatActivity.get(session.workspaceId);
    if (!current || ACTIVITY_RANK[next] > ACTIVITY_RANK[current]) {
      chatActivity.set(session.workspaceId, next);
    }
  }

  return { sessions, chatActivity, mutate };
}
