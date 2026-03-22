export interface ChatSessionInfo {
  id: string;
  workspaceId: string;
  startedAt: number;
}

export type SessionState = "idle" | "connecting" | "resuming" | "running" | "exited";

export type { ServerMessage } from "./chat-server";
