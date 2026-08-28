import type { DataListener, TerminalSubprocess } from "@/types/pty";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface ChatSession {
  id: string;
  workspaceId: string;
  proc: TerminalSubprocess;
  listeners: Set<DataListener>;
  exited: boolean;
  exitCode: number | null;
  outputBuffer: Uint8Array[];
  activeWs: { send(data: string): void } | null;
  exitedAt: number | null;
  startedAt: number;
  /** Size the PTY currently has, so a no-op resize can be skipped. */
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// WebSocket data attached to each connection
// ---------------------------------------------------------------------------

export interface WsData {
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

interface StartMessage {
  type: "start";
  workspaceId: string;
  initialPrompt?: string;
  reviewTimestamp?: string;
  researchChat?: boolean;
  /** Size of the browser terminal, so the PTY is born at the right size. */
  cols?: number;
  rows?: number;
}

interface InputMessage {
  type: "input";
  data: string;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

interface KillMessage {
  type: "kill";
}

interface ResumeMessage {
  type: "resume";
  sessionId: string;
  /** Size of the reconnecting browser terminal; may differ from the PTY's. */
  cols?: number;
  rows?: number;
}

export type ClientMessage = StartMessage | InputMessage | ResizeMessage | KillMessage | ResumeMessage;

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

interface ServerOutputMessage {
  type: "output";
  data: string;
}

interface ServerStartedMessage {
  type: "started";
  sessionId: string;
}

interface ServerExitedMessage {
  type: "exited";
  code: number;
}

interface ServerErrorMessage {
  type: "error";
  message: string;
}

interface ServerResumedMessage {
  type: "resumed";
  sessionId: string;
  exited: boolean;
  exitCode?: number;
  bufferedChunks: number;
}

interface ServerReplayDoneMessage {
  type: "replay_done";
}

export type ServerMessage =
  | ServerOutputMessage
  | ServerStartedMessage
  | ServerExitedMessage
  | ServerErrorMessage
  | ServerResumedMessage
  | ServerReplayDoneMessage;
