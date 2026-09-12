export interface ChatSessionInfo {
  id: string;
  workspaceId: string;
  startedAt: number;
  /**
   * Whether the session is working rather than waiting for the user to type.
   * Derived server-side from how recently the PTY wrote, so no caller has to
   * compare its own clock against the chat server's.
   *
   * Optional because the chat server is a separate process from the Next.js
   * one: under `dev:hot` only the latter reloads, so a chat server started
   * before this field existed answers without it. Absence must read as
   * unknown, never as `false` — the field is reported by the one process that
   * can see the PTY, and guessing `false` labels a working session idle.
   */
  busy?: boolean;
}

export type SessionState = "idle" | "connecting" | "resuming" | "running" | "exited";

export type { ServerMessage } from "./chat-server";
