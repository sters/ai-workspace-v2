// Bun.spawn-based Claude CLI runner.
// Spawns `claude -p` with `--output-format stream-json` and streams events
// in the same format as @anthropic-ai/claude-agent-sdk.

import type { Subprocess } from "bun";
import { getCliPath } from "./cli-path";
import type { ClaudeProcess } from "@/types/claude";
import { AI_WORKSPACE_ROOT } from "../config";
import type { OperationEvent } from "@/types/operation";

// Maximum argument length before falling back to stdin (ARG_MAX safety margin)
const MAX_PROMPT_ARG_LENGTH = 200_000;

// Minimal shape of a stream-json event for internal inspection
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamEvent = Record<string, any>;

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

export interface RunClaudeOptions {
  /** JSON Schema to constrain the model's final text response via --json-schema. */
  jsonSchema?: Record<string, unknown>;
}

export function runClaude(
  operationId: string,
  prompt: string,
  options?: RunClaudeOptions,
): ClaudeProcess {
  const handlers: ((event: OperationEvent) => void)[] = [];
  const earlyEvents: OperationEvent[] = [];

  let sessionId: string | null = null;
  let pendingAskToolUseId: string | null = null;
  let currentProc: Subprocess | null = null;
  let killed = false;

  const emit = (event: OperationEvent) => {
    if (handlers.length === 0) {
      earlyEvents.push(event);
    } else {
      for (const h of handlers) h(event);
    }
  };

  log(operationId, "starting CLI query");
  log(operationId, "cwd:", AI_WORKSPACE_ROOT);
  log(operationId, "prompt:", prompt.slice(0, 200) + (prompt.length > 200 ? "..." : ""));
  log(operationId, "getCliPath():", getCliPath());

  // Accumulated result text from StructuredOutput tool_use or the "result" event
  let resultText: string | undefined;
  // Whether resultText was set from a StructuredOutput tool_use (takes precedence over result event)
  let hasStructuredOutput = false;

  function spawnAndStream(promptOrAnswer: string, resumeSessionId?: string) {
    const args = [getCliPath(), "-p", promptOrAnswer, "--output-format", "stream-json", "--verbose"];
    if (options?.jsonSchema) {
      args.push("--json-schema", JSON.stringify(options.jsonSchema));
    }
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    const useStdin = promptOrAnswer.length > MAX_PROMPT_ARG_LENGTH;
    const spawnArgs = useStdin
      ? [getCliPath(), "-p", "-", "--output-format", "stream-json", "--verbose", ...(options?.jsonSchema ? ["--json-schema", JSON.stringify(options.jsonSchema)] : []), ...(resumeSessionId ? ["--resume", resumeSessionId] : [])]
      : args;

    const env: Record<string, string | undefined> = { ...process.env, CLAUDECODE: undefined };

    log(operationId, "spawning:", spawnArgs.join(" ").slice(0, 300));
    if (useStdin) {
      log(operationId, "using stdin for prompt (length:", promptOrAnswer.length, ")");
    }

    const proc = Bun.spawn(spawnArgs, {
      cwd: AI_WORKSPACE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      stdin: useStdin ? "pipe" : undefined,
      env,
    });
    currentProc = proc;

    // Write prompt via stdin if too long for args
    if (useStdin && proc.stdin) {
      proc.stdin.write(promptOrAnswer);
      proc.stdin.end();
    }

    // Reset pending ask for the new process
    pendingAskToolUseId = null;

    (async () => {
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
            // Record session_id from system/init event
            if (parsed.type === "system" && parsed.session_id) {
              sessionId = parsed.session_id;
              log(operationId, "session_id:", sessionId);
            }

            // Capture result text from the result event (unless StructuredOutput already set it)
            if (parsed.type === "result" && parsed.subtype === "success" && typeof parsed.result === "string" && !hasStructuredOutput) {
              resultText = parsed.result;
            }

            // Detect AskUserQuestion / StructuredOutput tool_use in assistant messages
            if (parsed.type === "assistant" && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === "tool_use" && block.name === "AskUserQuestion") {
                  pendingAskToolUseId = block.id;
                  log(operationId, "AskUserQuestion detected, toolUseId:", block.id);
                }
                // Capture structured output from --json-schema responses
                if (block.type === "tool_use" && block.name === "StructuredOutput" && block.input) {
                  resultText = JSON.stringify(block.input);
                  hasStructuredOutput = true;
                  log(operationId, "StructuredOutput captured:", resultText.slice(0, 200));
                }
              }
            }

            // Check result for AskUserQuestion permission denial
            if (parsed.type === "result" && pendingAskToolUseId) {
              const hasAskDenial = parsed.permission_denials?.some(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (d: any) => d.tool_name === "AskUserQuestion"
              );
              if (hasAskDenial) {
                log(operationId, "AskUserQuestion permission denied, will wait for answer");
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

        // Flush remaining buffer
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

      // Read stderr for diagnostics
      try {
        const stderrText = await new Response(proc.stderr).text();
        if (stderrText.trim()) {
          log(operationId, "stderr:", stderrText.trim().slice(0, 500));
        }
      } catch {
        // Ignore stderr read errors
      }

      // Wait for process exit
      const exitCode = await proc.exited;
      log(operationId, "process exited with code:", exitCode);

      if (pendingAskToolUseId && !killed) {
        // AskUserQuestion is pending — don't emit complete, wait for submitAnswer
        log(operationId, "waiting for AskUserQuestion answer...");
      } else {
        emit({
          type: "complete",
          operationId,
          data: JSON.stringify({ exitCode }),
          timestamp: new Date().toISOString(),
        });
      }
    })();
  }

  // Initial spawn
  spawnAndStream(prompt);

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
      currentProc?.kill();
    },
    submitAnswer: (toolUseId, answers) => {
      if (toolUseId !== pendingAskToolUseId || !sessionId) return false;
      pendingAskToolUseId = null;

      // Build answer text from the answers map
      const answerText = Object.entries(answers)
        .map(([q, a]) => `${q}: ${a}`)
        .join("\n");

      log(operationId, "resuming with answer, sessionId:", sessionId);

      // Resume with --resume
      spawnAndStream(answerText, sessionId);
      return true;
    },
    getResultText: () => resultText,
  };
}

// Interactive mode (non -p) is implemented via:
// - src/lib/chat-server.ts — WebSocket server (port 3742) with PTY-backed Claude sessions
// - src/components/workspace/chat-terminal.tsx — xterm.js frontend component
// - src/lib/pty.ts — shared PTY spawn/collect utilities
