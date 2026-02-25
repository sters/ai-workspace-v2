import { execSync } from "node:child_process";
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

const ARROW_DOWN = "\x1b[B";

/**
 * Run `claude mcp list` and return the 0-indexed position of the given server.
 * Returns -1 if the server is not found.
 */
function getServerIndex(serverName: string): number {
  const output = execSync("claude mcp list", {
    encoding: "utf-8",
    cwd: AI_WORKSPACE_ROOT,
    timeout: 30_000,
  });
  const servers: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+):\s/);
    if (match) servers.push(match[1]);
  }
  return servers.indexOf(serverName);
}

export interface McpAuthCallbacks {
  emitStatus: (message: string) => void;
  emitTerminal: (data: string) => void;
  signal?: AbortSignal;
}

/**
 * Run an MCP authentication session using deterministic steps:
 * 1. Look up server index via `claude mcp list`
 * 2. Spawn claude CLI in a PTY
 * 3. Send `/mcp` + Enter to open MCP server list
 * 4. Navigate to the target server with ARROW_DOWN
 * 5. Enter to open server settings, Enter to select "Authenticate"
 * 6. Poll for OAuth completion
 */
export async function runMcpAuthSession(
  serverName: string,
  callbacks: McpAuthCallbacks,
  options?: { forceReauth?: boolean },
): Promise<boolean> {
  const { emitStatus, emitTerminal, signal } = callbacks;
  const _forceReauth = options?.forceReauth ?? false;

  // Step 1: Get server index
  emitStatus(`Looking up server index for "${serverName}"...`);
  let serverIndex: number;
  try {
    serverIndex = getServerIndex(serverName);
  } catch (err) {
    emitStatus(`Failed to run "claude mcp list": ${err}`);
    return false;
  }
  if (serverIndex < 0) {
    emitStatus(`Server "${serverName}" not found in "claude mcp list" output`);
    return false;
  }
  emitStatus(`Server "${serverName}" is at index ${serverIndex}`);

  // Step 2: Spawn PTY
  const claudeCmd = "claude";
  const env = { ...process.env };
  delete env.CLAUDECODE;

  emitStatus(`Starting Claude CLI session...`);

  const listeners = new Set<DataListener>();

  let proc: TerminalSubprocess;
  try {
    proc = spawnTerminal([claudeCmd], { cwd: AI_WORKSPACE_ROOT, env }, listeners);
  } catch (spawnErr) {
    const err = spawnErr as Error;
    emitStatus(`Failed to spawn "${claudeCmd}": ${err.message}`);
    return false;
  }
  emitStatus("PTY spawned successfully");

  listeners.add((data) => emitTerminal(data));

  // Kill PTY when the operation is cancelled
  if (signal) {
    signal.addEventListener("abort", () => {
      emitStatus("Operation cancelled, killing CLI process...");
      proc.kill();
    }, { once: true });
  }

  let exited = false;
  let exitCode: number | null = null;
  proc.exited.then((code) => {
    exited = true;
    exitCode = code;
    emitStatus(`Claude CLI process exited (code ${code})`);
  });

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    // Step 3: Wait for initial prompt
    const initOutput = await collectOutput(listeners, 2000, 15000);
    const cleaned = stripAnsi(initOutput).trim();
    emitStatus(`CLI output (${cleaned.length} chars): ${cleaned.slice(0, 500)}`);

    if (exited) {
      emitStatus(`Claude CLI exited (code ${exitCode}) before /mcp. Output: ${cleaned}`);
      return false;
    }

    // Step 4: Send /mcp command
    emitStatus(`[debug] forceReauth=${_forceReauth}, serverIndex=${serverIndex}`);
    emitStatus("Sending /mcp command...");
    proc.terminal.write("/mcp");
    await delay(500);
    proc.terminal.write("\r");
    await delay(300);
    let output = await collectOutput(listeners, 1500, 15000);
    emitStatus(`/mcp output:\n${stripAnsi(output)}`);

    if (exited) return false;

    // Step 5: Navigate to server with ARROW_DOWN
    if (serverIndex > 0) {
      emitStatus(`[debug] Sending ARROW_DOWN x${serverIndex} to reach "${serverName}"`);
      for (let i = 0; i < serverIndex; i++) {
        emitStatus(`[debug] Sending ARROW_DOWN (${i + 1}/${serverIndex})`);
        proc.terminal.write(ARROW_DOWN);
        await delay(300);
      }
      output = await collectOutput(listeners, 500, 5000);
      emitStatus(`After navigation:\n${stripAnsi(output)}`);
    }

    // Step 6: Enter to open server settings
    emitStatus("[debug] Sending ENTER to open server settings");
    proc.terminal.write("\r");
    await delay(300);
    output = await collectOutput(listeners, 1000, 10000);
    emitStatus(`Server settings:\n${stripAnsi(output)}`);

    if (exited) return false;

    // Step 7: Select auth action
    // The settings screen shows a menu with focus on the first item.
    // - needs_auth: "1. Authenticate" is focused → just Enter
    // - reauth: "1. View tools" is focused → ARROW_DOWN to "2. Re-authenticate" → Enter
    if (_forceReauth) {
      emitStatus('[debug] forceReauth=true, sending ARROW_DOWN to reach "Re-authenticate"');
      proc.terminal.write(ARROW_DOWN);
      await delay(300);
      output = await collectOutput(listeners, 500, 5000);
      emitStatus(`[debug] After ARROW_DOWN:\n${stripAnsi(output)}`);
    }
    emitStatus(`[debug] Sending ENTER to select "${_forceReauth ? "Re-authenticate" : "Authenticate"}"`);
    proc.terminal.write("\r");
    await delay(300);
    output = await collectOutput(listeners, 1000, 10000);
    emitStatus(`After authenticate:\n${stripAnsi(output)}`);

    if (exited) return false;

    // Step 8: Poll for OAuth completion (max 60 seconds)
    emitStatus("Waiting for OAuth completion (up to 60s)...");
    const pollStart = Date.now();
    const pollTimeout = 60_000;

    while (Date.now() - pollStart < pollTimeout) {
      if (exited) break;

      output = await collectOutput(listeners, 2000, 5000);
      const cleanedOutput = stripAnsi(output).toLowerCase();

      if (cleanedOutput.includes("authentication successful") || cleanedOutput.includes("connected") || output.includes("✓")) {
        emitStatus("Authentication successful!");
        proc.terminal.write("/exit");
        await delay(300);
        proc.terminal.write("\r");
        setTimeout(() => proc.kill(), 2000);
        return true;
      }

      if (output.length > 0) {
        emitStatus(`OAuth polling:\n${stripAnsi(output)}`);
      }
    }

    emitStatus("OAuth polling timed out after 60 seconds");
    proc.kill();
    return false;
  } catch (err) {
    emitStatus(`Auth session error: ${err}`);
    proc.kill();
    return false;
  }
}
