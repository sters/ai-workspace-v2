export interface ChatSessionInfo {
  id: string;
  workspaceId: string;
  startedAt: number;
}

export type SessionState = "idle" | "connecting" | "resuming" | "running" | "exited";

export interface ServerMessage {
  type: "output" | "started" | "exited" | "error" | "resumed" | "replay_done";
  data?: string;
  sessionId?: string;
  code?: number;
  message?: string;
  exited?: boolean;
  exitCode?: number;
  bufferedChunks?: number;
}
