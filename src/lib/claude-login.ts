import { execFile } from "node:child_process";

export interface ClaudeLoginCallbacks {
  emitStatus: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Check current auth status via `claude auth status`.
 * Returns the trimmed stdout output.
 */
export function checkAuthStatus(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("claude", ["auth", "status"], { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Run `claude auth login` and return true on success.
 * Streams status messages via callbacks.
 */
export async function runClaudeLogin(
  callbacks: ClaudeLoginCallbacks,
): Promise<boolean> {
  const { emitStatus, signal } = callbacks;

  // Step 1: Check current status
  emitStatus("Checking current auth status...");
  try {
    const status = await checkAuthStatus();
    emitStatus(`Current status: ${status}`);
  } catch (err) {
    emitStatus(`Auth status check failed: ${err}`);
  }

  // Step 2: Run claude auth login
  emitStatus("Running claude auth login...");

  return new Promise<boolean>((resolve) => {
    const child = execFile(
      "claude",
      ["auth", "login"],
      { timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          emitStatus(`Login failed: ${stderr || err.message}`);
          resolve(false);
        } else {
          const output = stdout.trim();
          if (output) emitStatus(output);
          emitStatus("Login completed successfully!");
          resolve(true);
        }
      },
    );

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          emitStatus("Operation cancelled");
          child.kill();
          resolve(false);
        },
        { once: true },
      );
    }
  });
}
