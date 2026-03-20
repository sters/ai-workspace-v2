// Bun.spawn-based Claude CLI runner.
// Spawns `claude -p` with `--output-format stream-json` and streams events
// in the same format as @anthropic-ai/claude-agent-sdk.

import type { Subprocess } from "bun";
import type { ClaudeProcess, RunClaudeOptions, SpawnClaudeOptions, SpawnClaudeTerminalOptions, StreamEvent } from "@/types/claude";
import type { TerminalSubprocess } from "@/types/pty";
import { AI_WORKSPACE_ROOT, getConfig } from "../config";
import type { OperationEvent } from "@/types/operation";
import { spawnTerminal } from "../pty";
import { permissionDenialItemSchema, toolResultBlockSchema } from "../runtime-schemas";

// ---------------------------------------------------------------------------
// CLI path resolution (moved from cli-path.ts)
// ---------------------------------------------------------------------------

let _cliPath: string | null = null;

function resolveCliPath(): string {
  // Allow explicit override via CLAUDE_PATH env var
  if (process.env.AIW_CLAUDE_PATH) {
    return process.env.AIW_CLAUDE_PATH;
  }
  // Check config file for claude.path
  const configPath = getConfig().claude.path;
  if (configPath) {
    return configPath;
  }

  const bin = Bun.which("claude");
  if (!bin) {
    console.warn("[cli-path] claude CLI not found in PATH");
    return "claude";
  }

  // Try realpath
  const realpathResult = Bun.spawnSync(["realpath", bin], { stdout: "pipe", stderr: "pipe" });
  if (realpathResult.success) {
    const resolved = realpathResult.stdout.toString().trim();
    if (resolved) return resolved;
  }

  // Try readlink -f
  const readlinkResult = Bun.spawnSync(["readlink", "-f", bin], { stdout: "pipe", stderr: "pipe" });
  if (readlinkResult.success) {
    const resolved = readlinkResult.stdout.toString().trim();
    if (resolved) return resolved;
  }

  return bin;
}

export function getCliPath(): string {
  if (_cliPath === null) _cliPath = resolveCliPath();
  return _cliPath;
}

/** Reset cached path (for testing). */
export function _resetCliPath(): void {
  _cliPath = null;
}

// ---------------------------------------------------------------------------
// Shared spawn utilities
// ---------------------------------------------------------------------------

/** Build a clean env object with CLAUDECODE cleared and optional extras merged. */
export function getClaudeEnv(
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...process.env, CLAUDECODE: undefined, ...extra };
}

/** Spawn Claude CLI asynchronously via Bun.spawn. */
export function spawnClaude(options: SpawnClaudeOptions) {
  const { args, cwd = AI_WORKSPACE_ROOT, stdin, env } = options;
  return Bun.spawn([getCliPath(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin,
    env: env ?? getClaudeEnv(),
  });
}

/** Spawn Claude CLI synchronously via Bun.spawnSync. */
export function spawnClaudeSync(options: Omit<SpawnClaudeOptions, "stdin">) {
  const { args, cwd = AI_WORKSPACE_ROOT, env } = options;
  return Bun.spawnSync([getCliPath(), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ?? getClaudeEnv(),
  });
}

/** Spawn Claude CLI in interactive PTY mode via spawnTerminal. */
export function spawnClaudeTerminal(options: SpawnClaudeTerminalOptions): TerminalSubprocess {
  const { args, cwd = AI_WORKSPACE_ROOT, env, listeners, cols, rows } = options;
  return spawnTerminal(
    [getCliPath(), ...args],
    { cwd, env: env ?? getClaudeEnv(), cols, rows },
    listeners,
  );
}

// Always pass prompts via stdin to avoid exposing them in the process list.
// Previously used a 200k char threshold, but even short prompts are visible
// in `ps` output when passed as command-line arguments.
const MAX_PROMPT_ARG_LENGTH = 0;

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
  log(operationId, "cwd:", options?.cwd ?? AI_WORKSPACE_ROOT);
  log(operationId, "prompt:", prompt.slice(0, 200) + (prompt.length > 200 ? "..." : ""));
  log(operationId, "getCliPath():", getCliPath());

  // Accumulated result text from StructuredOutput tool_use or the "result" event
  let resultText: string | undefined;
  // Whether resultText was set from a StructuredOutput tool_use (takes precedence over result event)
  let hasStructuredOutput = false;

  function spawnAndStream(promptOrAnswer: string, resumeSessionId?: string) {
    const useStdin = promptOrAnswer.length > MAX_PROMPT_ARG_LENGTH;

    // When addDirs are specified, auto-allow Edit/Write scoped to those
    // directories plus Bash(git:*) so Claude can modify files and run git
    // commands there in non-interactive (-p) mode.
    const addDirAllowedTools = options?.addDirs?.length
      ? ["--allowedTools", [
          ...options.addDirs.flatMap((dir) => {
            // Claude CLI uses // prefix for absolute filesystem paths.
            // /path means project-root-relative, //path means absolute.
            const absPrefix = dir.startsWith("/") ? "/" : "//";
            return [
              `Edit(${absPrefix}${dir}/**)`,
              `Write(${absPrefix}${dir}/**)`,
            ];
          }),
          "Bash(git:*)",
        ].join(",")]
      : [];

    const cliArgs = [
      "-p", useStdin ? "-" : promptOrAnswer,
      "--output-format", "stream-json",
      "--verbose",
      ...(options?.jsonSchema ? ["--json-schema", JSON.stringify(options.jsonSchema)] : []),
      ...(options?.addDirs?.flatMap((dir) => ["--add-dir", dir]) ?? []),
      ...addDirAllowedTools,
      ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
    ];

    const fullCmd = [getCliPath(), ...cliArgs].join(" ");
    log(operationId, "spawning:", fullCmd.slice(0, 300));
    if (addDirAllowedTools.length) {
      const allowedToolsValue = addDirAllowedTools.join(" ");
      log(operationId, "allowedTools:", allowedToolsValue);
      emit({
        type: "output",
        operationId,
        data: `[debug] allowedTools: ${allowedToolsValue}`,
        timestamp: new Date().toISOString(),
      });
    }
    if (useStdin) {
      log(operationId, "using stdin for prompt (length:", promptOrAnswer.length, ")");
    }

    const proc = spawnClaude({
      args: cliArgs,
      cwd: options?.cwd,
      stdin: useStdin ? "pipe" : undefined,
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
        let askKilled = false;

        for (;;) {
          if (askKilled) break;
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
              const denials = Array.isArray(parsed.permission_denials) ? parsed.permission_denials : [];
              const hasAskDenial = denials.some((d: unknown) => {
                const r = permissionDenialItemSchema.safeParse(d);
                return r.success && r.data.tool_name === "AskUserQuestion";
              });
              if (hasAskDenial) {
                log(operationId, "AskUserQuestion permission denied, will wait for answer");
              }
            }

            // Detect CLI's auto-error response to AskUserQuestion in -p mode.
            // The CLI can't show interactive UI, so it auto-responds with
            // tool_result { is_error: true, content: "Answer questions?" }.
            // When skipAskUserQuestion is set, let the auto-error flow through
            // so Claude continues without waiting for user input.
            // Otherwise, suppress the event and kill the process so the UI
            // can present the question to the user.
            if (pendingAskToolUseId && parsed.type === "user" && parsed.message?.content) {
              const blocks = Array.isArray(parsed.message.content)
                ? parsed.message.content
                : [];
              const isAskAutoError = blocks.some((b: unknown) => {
                const r = toolResultBlockSchema.safeParse(b);
                return r.success && r.data.tool_use_id === pendingAskToolUseId && r.data.is_error;
              });
              if (isAskAutoError) {
                if (options?.skipAskUserQuestion) {
                  log(operationId, "skipAskUserQuestion: letting CLI auto-error flow through, continuing");
                  pendingAskToolUseId = null; // Clear so we don't wait for answer
                } else {
                  log(operationId, "suppressing CLI auto-error for AskUserQuestion, killing process");
                  askKilled = true;
                  proc.kill();
                  break; // Stop processing this chunk; outer loop checks askKilled
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
