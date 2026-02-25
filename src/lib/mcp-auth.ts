import { cliPath } from "./claude-sdk";
import { AI_WORKSPACE_ROOT } from "./config";
import {
  spawnTerminal,
  collectOutput,
  type DataListener,
  type TerminalSubprocess,
} from "./pty";

function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

// Escape sequences for terminal navigation keys
const KEY_MAP: Record<string, string> = {
  ENTER: "\r",
  ARROW_DOWN: "\x1b[B",
  ARROW_UP: "\x1b[A",
  ESCAPE: "\x1b",
  TAB: "\t",
};

type AuthAction =
  | { action: "type"; value: string }
  | { action: "key"; value: string }
  | { action: "done"; value: string }
  | { action: "wait_browser"; value: string }
  | { action: "error"; value: string };

/** JSON Schema for structured output from the analyzer. */
const AUTH_ACTION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["type", "key", "done", "wait_browser", "error"],
      description: "The action to take next.",
    },
    value: {
      type: "string",
      description:
        "For 'type': the exact text to type (Enter is sent automatically). " +
        "For 'key': one of ENTER, ARROW_DOWN, ARROW_UP, ESCAPE, TAB. " +
        "For 'done': a short description of the outcome. " +
        "For 'wait_browser': a short description. " +
        "For 'error': the error description.",
    },
  },
  required: ["action", "value"],
  additionalProperties: false,
};

/**
 * Use a separate Claude session to analyze CLI output
 * and determine what key input to send next.
 * Returns structured JSON via --json-schema.
 */
async function analyzeOutput(
  cliOutput: string,
  serverName: string,
  forceReauth: boolean,
): Promise<AuthAction> {
  const doneRule = forceReauth
    ? [
        `- Do NOT respond with action "done" just because the server shows as "connected" in the server list. You must actually trigger re-authentication.`,
        `- After selecting the server "${serverName}", look for an "Authenticate" option in the submenu and select it.`,
        `- Only respond with action "done" after the re-authentication flow has been completed (e.g. browser OAuth succeeded, token was accepted, or the auth process explicitly finished).`,
      ]
    : [
        `- If the authentication flow completed successfully (e.g. browser OAuth succeeded, token accepted), respond with action "done".`,
        `- If the server shows as needing auth, navigate to it and start the auth flow.`,
      ];

  const prompt = [
    `You are analyzing output from an interactive Claude Code CLI session.`,
    `The goal is to ${forceReauth ? "re-authenticate" : "authenticate"} with the MCP server named "${serverName}".`,
    `The CLI uses a TUI (terminal UI) with interactive menus navigated by arrow keys and Enter.`,
    ``,
    `Here is the current CLI output (ANSI codes stripped):`,
    `---`,
    stripAnsi(cliOutput),
    `---`,
    ``,
    `Determine what action to take next. Respond with a JSON object matching the provided schema.`,
    ``,
    `Rules:`,
    `- The /mcp command opens a TUI menu with selectable items. Do NOT type numbers.`,
    `- To navigate a TUI list/selector, use action "key" with value "ARROW_DOWN" or "ARROW_UP" to move between items.`,
    `- To select the currently highlighted item, use action "key" with value "ENTER".`,
    `- If the server "${serverName}" appears in a list, navigate to it with ARROW_DOWN/ARROW_UP, then select with ENTER.`,
    `- If a text input prompt is shown (asking for a URL, token, etc.), use action "type" with value set to the required text.`,
    ...doneRule,
    `- If a browser was opened for OAuth, respond with action "wait_browser".`,
    `- If there is an error, respond with action "error" and describe the error in value.`,
    `- Do NOT use any tools.`,
  ].join("\n");

  const env: Record<string, string | undefined> = { ...process.env, CLAUDECODE: undefined };

  try {
    const proc = Bun.spawn(
      [
        cliPath, "-p", prompt,
        "--output-format", "json",
        "--json-schema", JSON.stringify(AUTH_ACTION_SCHEMA),
      ],
      {
        cwd: AI_WORKSPACE_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env,
      }
    );

    const [output, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (!output.trim()) {
      const detail = stderrText.trim()
        ? `stderr: ${stderrText.trim().slice(0, 300)}`
        : `exit code ${exitCode}`;
      return { action: "error", value: `CLI returned empty output (${detail})` };
    }

    // --output-format json wraps in {"result":"...",...}
    // --json-schema makes result a JSON string like '{"action":"key","value":"ENTER"}'
    let actionObj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(output);
      const resultText: string = typeof parsed.result === "string"
        ? parsed.result
        : typeof parsed.result === "object" && parsed.result !== null
          ? JSON.stringify(parsed.result)
          : output;
      actionObj = typeof resultText === "string" ? JSON.parse(resultText) : resultText;
    } catch (parseErr) {
      // Fallback: try parsing the raw output directly as JSON
      try {
        actionObj = JSON.parse(output);
      } catch {
        return {
          action: "error",
          value: `JSON parse failed: ${parseErr}. Raw output: ${output.slice(0, 300)}`,
        };
      }
    }

    const action = String(actionObj.action ?? "");
    const value = String(actionObj.value ?? "");

    if (action === "key" && !KEY_MAP[value]) {
      return { action: "error", value: `Unknown key name: ${value}` };
    }

    if (["type", "key", "done", "wait_browser", "error"].includes(action)) {
      return { action, value } as AuthAction;
    }

    return { action: "error", value: `Unexpected action: ${action}` };
  } catch (err) {
    return { action: "error", value: `CLI analysis failed: ${err}` };
  }
}

export interface McpAuthCallbacks {
  emitStatus: (message: string) => void;
  emitTerminal: (data: string) => void;
}

/**
 * Run an MCP authentication session:
 * 1. Spawn claude CLI in a PTY via Bun.spawn with terminal option
 * 2. Send `/mcp` command
 * 3. Use a separate SDK session to analyze output and determine key inputs
 * 4. Send inputs to the CLI until auth completes
 */
export async function runMcpAuthSession(
  serverName: string,
  callbacks: McpAuthCallbacks,
  options?: { forceReauth?: boolean },
): Promise<boolean> {
  const { emitStatus, emitTerminal } = callbacks;
  const forceReauth = options?.forceReauth ?? false;

  const claudeCmd = "claude";
  const env = { ...process.env };
  delete env.CLAUDECODE;

  emitStatus(`Starting Claude CLI session...`);
  emitStatus(`cmd: ${claudeCmd}, cwd: ${AI_WORKSPACE_ROOT}`);
  emitStatus(`cliPath (fallback): ${cliPath}`);

  // Data listener system for terminal output
  const listeners = new Set<DataListener>();

  let proc: TerminalSubprocess;
  try {
    proc = spawnTerminal([claudeCmd], { cwd: AI_WORKSPACE_ROOT, env }, listeners);
  } catch (spawnErr) {
    const err = spawnErr as Error;
    emitStatus(`Failed to spawn with "${claudeCmd}": ${err.message}`);
    // Try with absolute path as fallback
    emitStatus(`Retrying with absolute path: ${cliPath}`);
    try {
      proc = spawnTerminal([cliPath], { cwd: AI_WORKSPACE_ROOT, env }, listeners);
    } catch (retryErr) {
      const err2 = retryErr as Error;
      emitStatus(`Fallback also failed: ${err2.message}`);
      return false;
    }
  }
  emitStatus("PTY spawned successfully");

  // Forward raw PTY output to the client for xterm.js rendering
  listeners.add((data) => emitTerminal(data));

  let exited = false;
  let exitCode: number | null = null;
  proc.exited.then((code) => {
    exited = true;
    exitCode = code;
    emitStatus(`Claude CLI process exited (code ${code})`);
  });

  try {
    // Wait for initial prompt
    let output = await collectOutput(listeners, 2000, 15000);
    const cleaned = stripAnsi(output).trim();
    emitStatus(`CLI output (${cleaned.length} chars): ${cleaned.slice(0, 500)}`);

    if (exited) {
      emitStatus(
        `Claude CLI exited (code ${exitCode}) before /mcp. Output: ${cleaned}`
      );
      return false;
    }

    // Send /mcp
    emitStatus("Sending /mcp command...");
    proc.terminal.write("/mcp\r");
    output = await collectOutput(listeners, 1500, 15000);
    emitStatus(`/mcp output:\n${stripAnsi(output)}`);

    if (exited) return false;

    // Interaction loop — let the SDK analyzer drive inputs
    // Up to 20 steps to allow for browser auth polling
    let allOutput = output;
    for (let i = 0; i < 20; i++) {
      if (exited) break;

      emitStatus(`Analyzing output (step ${i + 1})...`);
      const action = await analyzeOutput(allOutput, serverName, forceReauth);
      emitStatus(`Analyzer: ${action.action} → ${action.value}`);

      switch (action.action) {
        case "done":
          emitStatus("Authentication flow completed.");
          proc.terminal.write("/exit\r");
          setTimeout(() => proc.kill(), 2000);
          return true;

        case "error":
          emitStatus(`Error: ${action.value}`);
          proc.kill();
          return false;

        case "wait_browser":
          // Poll in short intervals instead of blocking for the full duration.
          // The CLI screen updates when browser auth completes, so we collect
          // output for a short window and loop back to re-analyze.
          emitStatus(
            "Browser opened for OAuth. Polling for completion..."
          );
          output = await collectOutput(listeners, 2000, 15000);
          allOutput += "\n" + output;
          if (output.length > 0) {
            emitStatus(`Browser auth update:\n${stripAnsi(output)}`);
          } else {
            emitStatus("No new output yet, will re-check...");
          }
          break;

        case "key":
          emitStatus(`Sending key: ${action.value}`);
          proc.terminal.write(KEY_MAP[action.value]);
          output = await collectOutput(listeners, 1000, 10000);
          allOutput += "\n" + output;
          emitStatus(`Response:\n${stripAnsi(output)}`);
          break;

        case "type":
          emitStatus(`Typing: ${action.value}`);
          proc.terminal.write(action.value + "\r");
          output = await collectOutput(listeners, 1500, 10000);
          allOutput += "\n" + output;
          emitStatus(`Response:\n${stripAnsi(output)}`);
          break;
      }
    }

    proc.kill();
    return false;
  } catch (err) {
    emitStatus(`Auth session error: ${err}`);
    proc.kill();
    return false;
  }
}
