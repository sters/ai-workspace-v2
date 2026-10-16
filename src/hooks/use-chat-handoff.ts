"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearChatHandoff,
  onChatHandoffStashed,
  peekChatHandoff,
} from "@/lib/chat-handoff";

/**
 * What the page that navigated to this workspace's chat asked for — a task, a
 * topic, a chat variant. Read without consuming, and cleared only once a
 * session has it, so a reload before then still applies it and a reload after
 * resumes.
 *
 * A handoff stashed while the chat page is already open replaces this one and
 * moves `terminalKey`: keying the terminal on it remounts it, so the new
 * handoff gets exactly what a fresh navigation would — a live session is
 * resumed rather than displaced, and otherwise the handoff starts one.
 */
export function useChatHandoff(workspaceId: string) {
  const [state, setState] = useState(() => ({
    handoff: typeof window === "undefined" ? null : peekChatHandoff(workspaceId),
    terminalKey: 0,
  }));

  useEffect(
    () =>
      onChatHandoffStashed(workspaceId, () =>
        setState((prev) => ({
          handoff: peekChatHandoff(workspaceId),
          terminalKey: prev.terminalKey + 1,
        })),
      ),
    [workspaceId],
  );

  const onDelivered = useCallback(() => clearChatHandoff(workspaceId), [workspaceId]);

  return {
    handoff: state.handoff,
    terminalKey: state.terminalKey,
    onHandoffDelivered: state.handoff ? onDelivered : undefined,
  };
}
