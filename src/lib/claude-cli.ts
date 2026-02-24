// Bun.spawn-based Claude CLI runner.
// Spawns `claude -p` with `--output-format stream-json` and streams events
// in the same format as @anthropic-ai/claude-agent-sdk.

import type { Subprocess } from "bun";
import { cliPath, type ClaudeProcess } from "./claude-sdk";
import { AI_WORKSPACE_ROOT } from "./config";
import type { OperationEvent } from "@/types/operation";

// Maximum argument length before falling back to stdin (ARG_MAX safety margin)
const MAX_PROMPT_ARG_LENGTH = 200_000;

function log(operationId: string, ...args: unknown[]) {
  console.log(`[claude-cli][${operationId}]`, ...args);
}

export function runClaude(
  operationId: string,
  prompt: string,
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
  log(operationId, "cliPath:", cliPath);

  function spawnAndStream(promptOrAnswer: string, resumeSessionId?: string) {
    const args = [cliPath, "-p", promptOrAnswer, "--output-format", "stream-json"];
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    const useStdin = promptOrAnswer.length > MAX_PROMPT_ARG_LENGTH;
    const spawnArgs = useStdin
      ? [cliPath, "-p", "-", "--output-format", "stream-json", ...(resumeSessionId ? ["--resume", resumeSessionId] : [])]
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

          // Process complete lines
          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;

            // Parse JSON to extract session_id and detect AskUserQuestion
            try {
              const parsed = JSON.parse(line);

              // Record session_id from system/init event
              if (parsed.type === "system" && parsed.session_id) {
                sessionId = parsed.session_id;
                log(operationId, "session_id:", sessionId);
              }

              // Detect AskUserQuestion tool_use in assistant messages
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "tool_use" && block.name === "AskUserQuestion") {
                    pendingAskToolUseId = block.id;
                    log(operationId, "AskUserQuestion detected, toolUseId:", block.id);
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
            } catch {
              // Not valid JSON — emit as raw
            }

            emit({
              type: "output",
              operationId,
              data: line,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Flush remaining buffer
        const remaining = buffer.trim();
        if (remaining) {
          emit({
            type: "output",
            operationId,
            data: remaining,
            timestamp: new Date().toISOString(),
          });
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
  };
}

// TODO: Interactive mode (non -p)
// When -p cannot be used, we need:
// - xterm.js in the browser for terminal rendering
// - WebSocket endpoint for bidirectional stdin/stdout piping
// - Bun.spawn with PTY (terminal option) for the claude process
// - stdin pipe from browser → WebSocket → process.stdin
// - stdout pipe from process → WebSocket → xterm.js
