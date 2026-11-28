// Bun.spawn-based Claude CLI runner.
// Spawns `claude -p` speaking stream-json both ways and streams its events.
// Permission prompts come back over stdio (`--permission-prompt-tool stdio`):
// the only way `-p` offers AskUserQuestion, which is answered in place; every
// other prompt is denied, as plain `-p` would.

import type { Subprocess } from "bun";
import type { ClaudeProcess, RunClaudeOptions, SpawnClaudeOptions, SpawnClaudeTerminalOptions, StreamEvent } from "@/types/claude";
import type { TerminalSubprocess } from "@/types/pty";
import { getResolvedWorkspaceRoot, getConfig } from "../config";
import type { OperationEvent } from "@/types/operation";
import { spawnTerminal } from "../pty";
import { realpathSync } from "node:fs";
import { getCleanEnv } from "../env";
import { runProcess, type ProcessResult } from "../process/run";
import { aiwMcpConfigArgs } from "./aiw-mcp";
import { writeGrants } from "./read-only-tools";

let _cliPath: string | null = null;

function resolveCliPath(): string {
  if (process.env.AIW_CLAUDE_PATH) {
    return process.env.AIW_CLAUDE_PATH;
  }
  const configPath = getConfig().claude.path;
  if (configPath) {
    return configPath;
  }

  const bin = Bun.which("claude");
  if (!bin) {
    console.warn("[cli-path] claude CLI not found in PATH");
    return "claude";
  }

  try {
    return realpathSync(bin);
  } catch {
    return bin;
  }
}

export function getCliPath(): string {
  if (_cliPath === null) _cliPath = resolveCliPath();
  return _cliPath;
}

/** Reset cached path (for testing). */
export function _resetCliPath(): void {
  _cliPath = null;
}

/** Build a clean env object with CLAUDECODE cleared and optional extras merged. */
export function getClaudeEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return getCleanEnv({ CLAUDECODE: undefined, ...extra });
}

/** Spawn Claude CLI asynchronously via Bun.spawn. */
export function spawnClaude(options: SpawnClaudeOptions) {
  const { args, cwd = getResolvedWorkspaceRoot(), stdin, env } = options;
  return Bun.spawn([getCliPath(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin,
    env: env ?? getClaudeEnv(),
  });
}

/** Run a short Claude CLI command (`--version`, `mcp list`, …) to completion. */
export function runClaudeCommand(options: Omit<SpawnClaudeOptions, "stdin">): Promise<ProcessResult> {
  const { args, cwd = getResolvedWorkspaceRoot(), env } = options;
  return runProcess([getCliPath(), ...args], { cwd, env: env ?? getClaudeEnv() });
}

/**
 * The PTY is rendered by the browser's xterm.js, not by whatever terminal the
 * server was started from (none, under launchd), so its capabilities are
 * declared rather than inherited; without TERM the CLI draws in monochrome.
 */
const XTERM_JS_ENV = { TERM: "xterm-256color", COLORTERM: "truecolor" };

/** Spawn Claude CLI in interactive PTY mode via spawnTerminal. */
export function spawnClaudeTerminal(options: SpawnClaudeTerminalOptions): TerminalSubprocess {
  const { args, cwd = getResolvedWorkspaceRoot(), env, listeners, cols, rows } = options;
  return spawnTerminal(
    [getCliPath(), ...args],
    { cwd, env: { ...(env ?? getClaudeEnv()), ...XTERM_JS_ENV }, cols, rows },
    listeners,
  );
}

/** Patterns that indicate a fatal API error that should stop the process immediately. */
const FATAL_ERROR_PATTERNS = [/API Error:\s*401/i, /authentication_failed/i];

/**
 * Check if a stream event contains a fatal API error (e.g. 401 Unauthorized).
 * Returns the matched error message or null.
 */
export function detectFatalApiError(parsed: StreamEvent): string | null {
  const candidates: string[] = [];

  // result event with is_error / errors array
  if (parsed.type === "result" && parsed.is_error && parsed.errors?.length) {
    candidates.push(...parsed.errors);
  }
  // assistant message with error field
  if (parsed.error) {
    candidates.push(String(parsed.error));
  }
  // auth_status error
  if (parsed.type === "auth_status" && parsed.error) {
    candidates.push(String(parsed.error));
  }
  // result text itself
  if (parsed.type === "result" && typeof parsed.result === "string") {
    candidates.push(parsed.result);
  }

  for (const text of candidates) {
    for (const pattern of FATAL_ERROR_PATTERNS) {
      if (pattern.test(text)) {
        return text;
      }
    }
  }
  return null;
}

function log(operationId: string, ...args: unknown[]) {
  console.log(`[claude-cli][${operationId}]`, ...args);
}

/**
 * Extended ClaudeProcess that reports the subprocess it spawns, so wireChild
 * can keep managed.childProcesses up to date.
 */
export interface ClaudeProcessWithTracking extends ClaudeProcess {
  onProcessSpawned: (callback: (proc: Subprocess) => void) => void;
}

export function runClaude(
  operationId: string,
  prompt: string,
  options?: RunClaudeOptions,
): ClaudeProcessWithTracking {
  const handlers: ((event: OperationEvent) => void)[] = [];
  const earlyEvents: OperationEvent[] = [];

  let sessionId: string | null = null;
  let pendingAsk: { toolUseId: string; requestId: string; input: Record<string, unknown> } | null = null;
  let currentProc: Subprocess | null = null;
  let killed = false;

  const processSpawnedCallbacks: ((proc: Subprocess) => void)[] = [];

  const emit = (event: OperationEvent) => {
    if (handlers.length === 0) {
      earlyEvents.push(event);
    } else {
      for (const h of handlers) h(event);
    }
  };

  log(operationId, `starting CLI query — cwd=${options?.cwd ?? getResolvedWorkspaceRoot()}, model=${options?.model ?? "default"}, effort=${options?.effort ?? "default"}, prompt=${prompt.length}chars`);

  // Accumulated result text from StructuredOutput tool_use or the "result" event
  let resultText: string | undefined;
  // All assistant text blocks seen so far (intermediate + final), for interim
  // progress snapshots via getAssistantText().
  const assistantTextParts: string[] = [];
  // Whether resultText was set from a StructuredOutput tool_use (takes precedence over result event)
  let hasStructuredOutput = false;

  function spawnAndStream(prompt: string, resumeSessionId?: string) {
    // Always pass prompts via stdin to avoid exposing them in the process list.

    const addDirAllowedTools = options?.allowedTools?.length
      ? ["--allowedTools", options.allowedTools.join(",")]
      : options?.addDirs?.length
        ? ["--allowedTools", writeGrants(options.addDirs).join(",")]
        : [];

    const cliArgs = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      ...(options?.skipAskUserQuestion ? [] : ["--permission-prompt-tool", "stdio"]),
      ...(options?.aiwMcp ? aiwMcpConfigArgs() : []),
      "--verbose",
      ...(options?.model ? ["--model", options.model] : []),
      ...(options?.effort ? ["--effort", options.effort] : []),
      ...(options?.appendSystemPromptFile ? ["--append-system-prompt-file", options.appendSystemPromptFile] : []),
      ...(options?.jsonSchema ? ["--json-schema", JSON.stringify(options.jsonSchema)] : []),
      ...(options?.addDirs?.flatMap((dir) => ["--add-dir", dir]) ?? []),
      ...addDirAllowedTools,
      ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
    ];

    if (addDirAllowedTools.length) {
      const allowedToolsValue = addDirAllowedTools.join(" ");
      emit({
        type: "output",
        operationId,
        data: `[debug] allowedTools: ${allowedToolsValue}`,
        timestamp: new Date().toISOString(),
      });
    }

    const proc = spawnClaude({
      args: cliArgs,
      cwd: options?.cwd,
      stdin: "pipe",
    });
    currentProc = proc;

    // Notify external tracking structures about the new subprocess
    for (const cb of processSpawnedCallbacks) cb(proc);

    send = (message: unknown) => {
      if (!proc.stdin) return;
      try {
        proc.stdin.write(JSON.stringify(message) + "\n");
        proc.stdin.flush();
      } catch (err) {
        log(operationId, "stdin write error (process may have already exited):", err);
      }
    };
    const closeStdin = () => {
      try { proc.stdin?.end(); } catch { /* already closed */ }
    };
    send({ type: "user", message: { role: "user", content: prompt } });
    pendingAsk = null;

    (async () => {
      // Start reading stderr concurrently with stdout to avoid
      // pipe buffer deadlock when the CLI writes significant stderr output.
      const stderrPromise = new Response(proc.stderr).text().catch(() => "");

      try {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Use Bun.JSONL.parseChunk for incremental JSONL parsing
          const result = Bun.JSONL.parseChunk(buffer);
          if (result.read > 0) {
            buffer = buffer.slice(result.read);
          }

          for (const parsed of result.values as StreamEvent[]) {
            if (parsed.type === "control_request") {
              handleControlRequest(parsed);
              continue;
            }
            // The CLI reads stdin for further turns until it closes.
            if (parsed.type === "result") closeStdin();

            // The CLI's init event reports the model but not the effort, so
            // stamp the level we passed via --effort to keep it visible in the log.
            if (parsed.type === "system" && parsed.subtype === "init" && options?.effort) {
              parsed.effort = options.effort;
            }

            if (parsed.type === "system" && parsed.session_id) {
              if (sessionId !== parsed.session_id) {
                sessionId = parsed.session_id;
                log(operationId, `session_id=${sessionId} (resume with: claude --resume ${sessionId})`);
              }
            }

            // Capture result text from the result event (unless StructuredOutput already set it)
            if (parsed.type === "result" && parsed.subtype === "success" && typeof parsed.result === "string" && !hasStructuredOutput) {
              resultText = parsed.result;
            }

            // Detect AskUserQuestion / StructuredOutput tool_use in assistant messages
            if (parsed.type === "assistant" && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
                  assistantTextParts.push(block.text);
                }
                // Capture structured output from --json-schema responses
                if (block.type === "tool_use" && block.name === "StructuredOutput" && block.input) {
                  resultText = JSON.stringify(block.input);
                  hasStructuredOutput = true;
                }
              }
            }

            // Detect fatal API errors (e.g. 401 Unauthorized) — kill immediately
            const fatalError = detectFatalApiError(parsed);
            if (fatalError) {
              log(operationId, "fatal API error detected, killing process:", fatalError);
              killed = true;
              proc.kill();
              emit({
                type: "output",
                operationId,
                data: JSON.stringify(parsed),
                timestamp: new Date().toISOString(),
              });
              emit({
                type: "error",
                operationId,
                data: `Fatal API error: ${fatalError}`,
                timestamp: new Date().toISOString(),
              });
              emit({
                type: "complete",
                operationId,
                data: JSON.stringify({ exitCode: 1 }),
                timestamp: new Date().toISOString(),
              });
              return; // Stop reading stdout
            }

            emit({
              type: "output",
              operationId,
              data: JSON.stringify(parsed),
              timestamp: new Date().toISOString(),
            });
          }
        }

        if (buffer.trim()) {
          const final = Bun.JSONL.parseChunk(buffer);
          for (const parsed of final.values as StreamEvent[]) {
            emit({
              type: "output",
              operationId,
              data: JSON.stringify(parsed),
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        if (!killed) {
          log(operationId, "stdout read error:", err);
        }
      }

      // Read stderr diagnostics (started concurrently before stdout loop)
      try {
        const stderrText = await stderrPromise;
        if (stderrText.trim()) {
          log(operationId, "stderr:", stderrText.trim().slice(0, 500));
        }
      } catch {
        // stderr is diagnostics only; a failed read must not fail the run.
      }

      // Wait for process exit with a 30-second timeout.
      // If the process doesn't exit in time, send SIGKILL and return exit code 1.
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error("Process exit timeout")), 30000),
        ),
      ]).catch(() => {
        log(operationId, "process exit timeout, sending SIGKILL");
        try { proc.kill(9); } catch { /* already exited */ }
        return 1;
      });
      pendingAsk = null;
      emit({
        type: "complete",
        operationId,
        data: JSON.stringify({ exitCode }),
        timestamp: new Date().toISOString(),
      });
    })();
  }

  let send: (message: unknown) => void = () => {};

  function respond(requestId: string, response: unknown) {
    send({ type: "control_response", response: { subtype: "success", request_id: requestId, response } });
  }

  /** AskUserQuestion waits for `submitAnswer`; any other tool the settings did not allow is refused. */
  function handleControlRequest(message: StreamEvent) {
    const requestId = String(message.request_id ?? "");
    const request = (message.request ?? {}) as { subtype?: string; tool_name?: string; tool_use_id?: string; input?: Record<string, unknown> };
    if (request.subtype !== "can_use_tool") {
      send({ type: "control_response", response: { subtype: "error", request_id: requestId, error: `Unsupported control request: ${request.subtype}` } });
      return;
    }
    if (request.tool_name === "AskUserQuestion" && request.tool_use_id) {
      pendingAsk = { toolUseId: request.tool_use_id, requestId, input: request.input ?? {} };
      return;
    }
    respond(requestId, { behavior: "deny", message: `${request.tool_name} is not allowed in this run.` });
  }

  // Initial spawn (resume an existing session when requested, for multi-turn conversations)
  spawnAndStream(prompt, options?.resumeSessionId);

  return {
    id: operationId,
    onEvent: (handler) => {
      handlers.push(handler);
      // Replay events that arrived before handler was registered
      for (const event of earlyEvents) {
        handler(event);
      }
      earlyEvents.length = 0;
    },
    kill: () => {
      killed = true;
      if (currentProc) {
        currentProc.kill(); // SIGTERM
        // SIGKILL fallback after 5 seconds if the process doesn't exit
        const procRef = currentProc;
        setTimeout(() => {
          try { procRef.kill(9); } catch { /* already exited */ }
        }, 5000);
      }
    },
    onProcessSpawned: (callback: (proc: Subprocess) => void) => {
      processSpawnedCallbacks.push(callback);
    },
    submitAnswer: (toolUseId, answers) => {
      if (!pendingAsk || toolUseId !== pendingAsk.toolUseId) return false;
      const { requestId, input } = pendingAsk;
      pendingAsk = null;
      respond(requestId, { behavior: "allow", updatedInput: { ...input, answers } });
      return true;
    },
    getResultText: () => resultText,
    getSessionId: () => sessionId,
    getAssistantText: () => assistantTextParts.join("\n"),
  };
}

// Interactive mode (non -p) is implemented via:
// - src/lib/chat-server/ — WebSocket server (port 3742) with PTY-backed Claude sessions
// - src/components/workspace/chat-terminal.tsx — xterm.js frontend component
// - src/lib/pty.ts — shared PTY spawn/collect utilities
