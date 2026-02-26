export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

/** Spawn `claude auth <subcommand>` via Bun.spawn with piped stdio. */
export function spawnClaudeAuth(subcommand: string): SpawnResult {
  return Bun.spawn(["claude", "auth", subcommand], {
    stdout: "pipe",
    stderr: "pipe",
  }) as SpawnResult;
}

export interface ClaudeLoginCallbacks {
  emitStatus: (message: string) => void;
  signal?: AbortSignal;
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array()),
  );
}

/**
 * Check current auth status via `claude auth status`.
 * Returns the trimmed stdout output.
 */
export async function checkAuthStatus(): Promise<string> {
  const proc = spawnClaudeAuth("status");

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Exit code ${exitCode}`);
  }
  return stdout.trim();
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

  const proc = spawnClaudeAuth("login");

  const aborted = new Promise<"aborted">((resolve) => {
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          emitStatus("Operation cancelled");
          proc.kill();
          resolve("aborted");
        },
        { once: true },
      );
    }
  });

  const completed = Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  const result = await Promise.race([completed, aborted]);

  if (result === "aborted") {
    return false;
  }

  const [stdout, stderr, exitCode] = result;

  if (exitCode !== 0) {
    emitStatus(`Login failed: ${stderr.trim() || `Exit code ${exitCode}`}`);
    return false;
  }

  const output = stdout.trim();
  if (output) emitStatus(output);
  emitStatus("Login completed successfully!");
  return true;
}
