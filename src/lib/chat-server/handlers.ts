import path from "node:path";
import { existsSync } from "node:fs";
import { spawnClaudeTerminal } from "../claude/cli";
import { clampPtySize, resizeTerminal, DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS } from "../pty";
import type { DataListener } from "@/types/pty";
import { buildInitPrompt, buildReviewChatPrompt, buildResearchChatPrompt } from "@/lib/templates";
import { ensureSessionSystemPrompt, cleanupSessionSystemPrompt } from "@/lib/workspace/prompts";
import type { ChatSession, ClientMessage, ServerMessage, WsData } from "@/types/chat-server";
import { getConfig, getResolvedWorkspaceRoot } from "@/lib/config";

export function send(ws: { send(data: string): void }, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}
import { trimBuffer } from "./buffer";
import { getStore, nextSessionId, persistSessionCreated, persistSessionExited, persistSessionDeleted } from "./store";
import { runGc } from "./gc";

type Ws = { send(data: string): void; data: WsData };

export async function handleStart(ws: Ws, msg: Extract<ClientMessage, { type: "start" }>): Promise<void> {
  const store = getStore();
  const wsData = ws.data;

  const root = getResolvedWorkspaceRoot();
  const workspacePath = path.join(root, "workspace", msg.workspaceId);

  // Every built init prompt has the session read the README on its first turn,
  // so a workspace without one starts a session that can only go hunting for
  // the file. Refuse before touching the caller's existing session — a rejected
  // start must not cost them a live one. A caller-supplied prompt opts out.
  if (!msg.initialPrompt && !existsSync(path.join(workspacePath, "README.md"))) {
    send(ws, {
      type: "error",
      message: `Workspace "${msg.workspaceId}" has no README.md — run init before starting a chat session.`,
    });
    return;
  }

  if (wsData.sessionId) {
    // Kill existing session
    const existing = store.__chatSessions!.get(wsData.sessionId);
    if (existing && !existing.exited) {
      existing.proc.kill();
    }
    store.__chatSessions!.delete(wsData.sessionId);
    persistSessionDeleted(wsData.sessionId);
  }

  // Run GC opportunistically
  runGc();

  const sessionId = nextSessionId();
  wsData.sessionId = sessionId;

  const listeners = new Set<DataListener>();

  const isReviewChat = !msg.initialPrompt && !!msg.reviewTimestamp;
  const isResearchChat = !msg.initialPrompt && !msg.reviewTimestamp && !!msg.researchChat;
  const initPrompt = msg.initialPrompt
    || (msg.reviewTimestamp
      ? buildReviewChatPrompt(msg.workspaceId, workspacePath, msg.reviewTimestamp)
      : msg.researchChat
        ? buildResearchChatPrompt(msg.workspaceId, workspacePath)
        : buildInitPrompt(msg.workspaceId, workspacePath));

  const agentName = isReviewChat ? "review-chat" : isResearchChat ? "research-chat" : "chat";
  const systemPromptFile = ensureSessionSystemPrompt(
    workspacePath,
    agentName,
    sessionId,
    { workspaceId: msg.workspaceId },
  );

  const chatModel = getConfig().chat.model;
  const modelArgs = chatModel ? ["--model", chatModel] : [];

  // The browser's xterm is the real viewport, so the PTY is born its size.
  // Spawning at a fixed default and never correcting it is what made Claude's
  // TUI draw boxes and status lines at a width the viewport does not have.
  const size = msg.cols != null && msg.rows != null ? clampPtySize(msg.cols, msg.rows) : null;

  let proc;
  try {
    proc = spawnClaudeTerminal({
      args: ["--append-system-prompt-file", systemPromptFile, ...modelArgs, initPrompt],
      cwd: root,
      listeners,
      ...(size && { cols: size.cols, rows: size.rows }),
    });
  } catch (err) {
    send(ws, {
      type: "error",
      message: `Failed to spawn claude: ${err}`,
    });
    return;
  }

  const session: ChatSession = {
    id: sessionId,
    workspaceId: msg.workspaceId,
    proc,
    listeners,
    exited: false,
    exitCode: null,
    outputBuffer: [],
    activeWs: ws,
    exitedAt: null,
    startedAt: Date.now(),
    cols: size?.cols ?? DEFAULT_PTY_COLS,
    rows: size?.rows ?? DEFAULT_PTY_ROWS,
  };
  store.__chatSessions!.set(sessionId, session);
  persistSessionCreated(session);

  // Forward PTY output to buffer (raw bytes) + active WebSocket (decoded text)
  const outputListener: DataListener = (data, rawData) => {
    session.outputBuffer.push(rawData);
    session.outputBuffer = trimBuffer(session.outputBuffer);
    if (session.activeWs) {
      send(session.activeWs, { type: "output", data });
    }
  };
  listeners.add(outputListener);

  // Track process exit and clean up per-session system prompt file
  proc.exited.then((code) => {
    session.exited = true;
    session.exitCode = code;
    session.exitedAt = Date.now();
    persistSessionExited(sessionId, code);
    if (session.activeWs) {
      send(session.activeWs, { type: "exited", code });
    }
    cleanupSessionSystemPrompt(systemPromptFile);
  });

  send(ws, { type: "started", sessionId });

  console.log(
    `[chat-server] Session ${sessionId} started for workspace "${msg.workspaceId}"`,
  );
}

export function handleResume(ws: Ws, msg: Extract<ClientMessage, { type: "resume" }>): void {
  const store = getStore();
  const session = store.__chatSessions!.get(msg.sessionId);
  if (!session) {
    send(ws, { type: "error", message: "Session not found" });
    return;
  }

  // Update session's active WebSocket
  session.activeWs = ws;
  ws.data.sessionId = msg.sessionId;

  // Send resumed notification with buffer size
  send(ws, {
    type: "resumed",
    sessionId: session.id,
    exited: session.exited,
    exitCode: session.exitCode ?? undefined,
    bufferedChunks: session.outputBuffer.length,
  });

  // Replay buffered output — re-decode from raw bytes so multi-byte
  // UTF-8 characters that were split across chunks are decoded correctly.
  const replayDecoder = new TextDecoder();
  for (const chunk of session.outputBuffer) {
    const text = replayDecoder.decode(chunk, { stream: true });
    if (text) {
      send(ws, { type: "output", data: text });
    }
  }
  // Flush any trailing bytes held by the streaming decoder
  const trailing = replayDecoder.decode();
  if (trailing) {
    send(ws, { type: "output", data: trailing });
  }

  // Signal replay complete
  send(ws, { type: "replay_done" });

  // Only now resize, and only if the reconnecting browser is a different size:
  // the replayed bytes were drawn for the old size, so the SIGWINCH repaint has
  // to land after them or history overwrites the repaint. An identical size
  // needs no repaint — the replay reproduces the frame as it was drawn.
  if (msg.cols != null && msg.rows != null) {
    applyResize(session, msg.cols, msg.rows);
  }

  console.log(
    `[chat-server] Session ${session.id} resumed (${session.outputBuffer.length} buffered chunks, exited=${session.exited})`,
  );
}

/**
 * Push a new size into a live PTY and record it. Skips a resize to the size the
 * PTY already has, since that raises no SIGWINCH and buys nothing.
 */
function applyResize(session: ChatSession, cols: number, rows: number): void {
  if (session.exited) return;
  const next = clampPtySize(cols, rows);
  if (next.cols === session.cols && next.rows === session.rows) return;
  if (!resizeTerminal(session.proc, next.cols, next.rows)) return;
  session.cols = next.cols;
  session.rows = next.rows;
}

export function handleResize(ws: Ws, msg: Extract<ClientMessage, { type: "resize" }>): void {
  const store = getStore();
  const session = ws.data.sessionId
    ? store.__chatSessions!.get(ws.data.sessionId)
    : null;
  // A resize for a gone session is not worth an error frame — the browser
  // reports one on every layout change, including while a session is ending.
  if (!session) return;
  applyResize(session, msg.cols, msg.rows);
}

export function handleInput(ws: Ws, msg: Extract<ClientMessage, { type: "input" }>): void {
  const store = getStore();
  const session = ws.data.sessionId
    ? store.__chatSessions!.get(ws.data.sessionId)
    : null;
  if (!session || session.exited) {
    send(ws, {
      type: "error",
      message: "No active session",
    });
    return;
  }
  session.proc.terminal.write(msg.data);
}

export function handleKill(ws: Ws): void {
  const store = getStore();
  const session = ws.data.sessionId
    ? store.__chatSessions!.get(ws.data.sessionId)
    : null;
  if (session && !session.exited) {
    session.proc.kill();
  }
  // Explicit kill: remove session entirely
  if (session) {
    store.__chatSessions!.delete(session.id);
    persistSessionDeleted(session.id);
  }
}

export function handleClose(ws: Ws): void {
  const store = getStore();
  const wsData = ws.data;
  if (wsData.sessionId) {
    const session = store.__chatSessions!.get(wsData.sessionId);
    if (session) {
      // Detach WebSocket but keep session alive for resume
      session.activeWs = null;
      console.log(
        `[chat-server] WebSocket detached from session ${wsData.sessionId} (process continues)`,
      );
    }
  }
}
