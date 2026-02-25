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

/**
 * Use a separate Claude SDK session to analyze CLI output
 * and determine what key input to send next.
 */
async function analyzeOutput(
  cliOutput: string,
  serverName: string
): Promise<AuthAction> {
  const prompt = [
    `You are analyzing output from an interactive Claude Code CLI session.`,
    `The goal is to authenticate with the MCP server named "${serverName}".`,
    `The CLI uses a TUI (terminal UI) with interactive menus navigated by arrow keys and Enter.`,
    ``,
    `Here is the current CLI output (ANSI codes stripped):`,
    `---`,
    stripAnsi(cliOutput),
    `---`,
    ``,
    `Determine what action to take next. Respond with EXACTLY one line in one of these formats:`,
    `TYPE:<exact text to type followed by Enter, e.g. a slash command or text input>`,
    `KEY:<key name: ENTER, ARROW_DOWN, ARROW_UP, ESCAPE, TAB>`,
    `DONE`,
    `WAIT_BROWSER`,
    `ERROR:<description>`,
    ``,
    `Rules:`,
    `- The /mcp command opens a TUI menu with selectable items. Do NOT type numbers.`,
    `- To navigate a TUI list/selector, use KEY:ARROW_DOWN or KEY:ARROW_UP to move between items.`,
    `- To select the currently highlighted item, use KEY:ENTER.`,
    `- If the server "${serverName}" appears in a list, navigate to it with ARROW_DOWN/ARROW_UP, then select with ENTER.`,
    `- If a text input prompt is shown (asking for a URL, token, etc.), use TYPE: with the required text.`,
    `- If authentication completed or the server shows as connected, respond DONE.`,
    `- If a browser was opened for OAuth, respond WAIT_BROWSER.`,
    `- If there is an error, respond ERROR: with a description.`,
    `- Do NOT use any tools. Respond with ONLY one line.`,
  ].join("\n");

  const env: Record<string, string | undefined> = { ...process.env, CLAUDECODE: undefined };

  let result = "";
  try {
    const proc = Bun.spawn(
      [cliPath, "-p", prompt, "--output-format", "json"],
      {
        cwd: AI_WORKSPACE_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env,
      }
    );

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // --output-format json returns a JSON object with a result field
    try {
      const parsed = JSON.parse(output);
      result = parsed.result ?? "";
    } catch {
      // Fallback: use raw output
      result = output;
    }
  } catch (err) {
    return { action: "error", value: `CLI analysis failed: ${err}` };
  }

  const line = result.trim().split("\n")[0].trim();
  if (line.startsWith("TYPE:"))
    return { action: "type", value: line.slice(5).trim() };
  if (line.startsWith("KEY:")) {
    const keyName = line.slice(4).trim();
    if (KEY_MAP[keyName]) {
      return { action: "key", value: keyName };
    }
    return { action: "error", value: `Unknown key name: ${keyName}` };
  }
  if (line === "DONE")
    return { action: "done", value: "Authentication completed" };
  if (line === "WAIT_BROWSER")
    return { action: "wait_browser", value: "Waiting for browser auth" };
  if (line.startsWith("ERROR:"))
    return { action: "error", value: line.slice(6).trim() };

  return { action: "error", value: `Unexpected analyzer response: ${line}` };
}

export interface McpAuthCallbacks {
  emitStatus: (message: string) => void;
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
  callbacks: McpAuthCallbacks
): Promise<boolean> {
  const { emitStatus } = callbacks;

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

  let exited = false;
  let exitCode: number | null = null;
  proc.exited.then((code) => {
    exited = true;
    exitCode = code;
    emitStatus(`Claude CLI process exited (code ${code})`);
  });

  try {
    // Wait for initial prompt
    let output = await collectOutput(listeners, 3000, 15000);
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
    output = await collectOutput(listeners, 3000, 15000);
    emitStatus(`/mcp output:\n${stripAnsi(output)}`);

    if (exited) return false;

    // Interaction loop — let the SDK analyzer drive inputs
    // Up to 20 steps to allow for browser auth polling
    let allOutput = output;
    for (let i = 0; i < 20; i++) {
      if (exited) break;

      emitStatus(`Analyzing output (step ${i + 1})...`);
      const action = await analyzeOutput(allOutput, serverName);
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
          output = await collectOutput(listeners, 3000, 15000);
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
          output = await collectOutput(listeners, 3000, 15000);
          allOutput += "\n" + output;
          emitStatus(`Response:\n${stripAnsi(output)}`);
          break;

        case "type":
          emitStatus(`Typing: ${action.value}`);
          proc.terminal.write(action.value + "\r");
          output = await collectOutput(listeners, 3000, 15000);
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
