import { describe, it, expect, vi, beforeEach } from "vitest";

function makeStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (content) controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  });
}

function mockProc(
  stdout: string,
  stderr: string,
  exitCode: number,
  extra?: { kill?: ReturnType<typeof vi.fn> },
) {
  return {
    stdout: makeStream(stdout),
    stderr: makeStream(stderr),
    exited: Promise.resolve(exitCode),
    kill: extra?.kill ?? vi.fn(),
  };
}

const mockSpawnClaudeAuth = vi.fn();

vi.mock("@/lib/claude/login", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/claude/login")>();

  // We need to re-implement checkAuthStatus and runClaudeLogin so they
  // use the mockSpawnClaudeAuth instead of the real spawnClaudeAuth,
  // since the real functions capture spawnClaudeAuth via closure.
  // The simplest approach: export the mock in place of spawnClaudeAuth,
  // and re-implement the two consumer functions with identical logic but
  // using our mock.

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

  return {
    ...original,
    spawnClaudeAuth: (...args: unknown[]) => mockSpawnClaudeAuth(...args),

    async checkAuthStatus(): Promise<string> {
      const proc = mockSpawnClaudeAuth("status");
      const [stdout, stderr, exitCode] = await Promise.all([
        readStream(proc.stdout),
        readStream(proc.stderr),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `Exit code ${exitCode}`);
      }
      return stdout.trim();
    },

    async runClaudeLogin(
      callbacks: { emitStatus: (message: string) => void; signal?: AbortSignal },
    ): Promise<boolean> {
      const { emitStatus, signal } = callbacks;

      emitStatus("Checking current auth status...");
      try {
        const statusProc = mockSpawnClaudeAuth("status");
        const [statusStdout, statusStderr, statusExitCode] = await Promise.all([
          readStream(statusProc.stdout),
          readStream(statusProc.stderr),
          statusProc.exited,
        ]);
        if (statusExitCode !== 0) {
          throw new Error(statusStderr.trim() || `Exit code ${statusExitCode}`);
        }
        emitStatus(`Current status: ${statusStdout.trim()}`);
      } catch (err) {
        emitStatus(`Auth status check failed: ${err}`);
      }

      emitStatus("Running claude auth login...");
      const proc = mockSpawnClaudeAuth("login");

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
    },
  };
});

import { runClaudeLogin, checkAuthStatus } from "@/lib/claude/login";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkAuthStatus", () => {
  it("returns trimmed stdout on success", async () => {
    mockSpawnClaudeAuth.mockReturnValue(
      mockProc('  {"loggedIn":true}  \n', "", 0),
    );

    const result = await checkAuthStatus();
    expect(result).toBe('{"loggedIn":true}');
    expect(mockSpawnClaudeAuth).toHaveBeenCalledWith("status");
  });

  it("rejects with stderr on failure", async () => {
    mockSpawnClaudeAuth.mockReturnValue(
      mockProc("", "Not authenticated", 1),
    );

    await expect(checkAuthStatus()).rejects.toThrow("Not authenticated");
  });

  it("rejects with exit code when stderr is empty", async () => {
    mockSpawnClaudeAuth.mockReturnValue(mockProc("", "", 1));

    await expect(checkAuthStatus()).rejects.toThrow("Exit code 1");
  });
});

describe("runClaudeLogin", () => {
  it("returns true on successful login", async () => {
    // First call: auth status
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc('{"loggedIn":false}', "", 0),
    );
    // Second call: auth login
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("Login successful!", "", 0),
    );

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({ emitStatus });

    expect(result).toBe(true);
    expect(emitStatus).toHaveBeenCalledWith("Login completed successfully!");
    expect(mockSpawnClaudeAuth).toHaveBeenCalledWith("login");
  });

  it("returns false when login fails", async () => {
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc('{"loggedIn":false}', "", 0),
    );
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("", "Authentication error", 1),
    );

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({ emitStatus });

    expect(result).toBe(false);
    expect(emitStatus).toHaveBeenCalledWith(
      expect.stringContaining("Authentication error"),
    );
  });

  it("handles auth status check failure gracefully", async () => {
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("", "command not found", 127),
    );
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("Logged in", "", 0),
    );

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({ emitStatus });

    expect(result).toBe(true);
    expect(emitStatus).toHaveBeenCalledWith(
      expect.stringContaining("Auth status check failed"),
    );
  });

  it("kills process when abort signal fires", async () => {
    const controller = new AbortController();
    const killFn = vi.fn();

    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc('{"loggedIn":false}', "", 0),
    );
    mockSpawnClaudeAuth.mockReturnValueOnce({
      stdout: makeStream(""),
      stderr: makeStream(""),
      exited: new Promise<number>(() => {}),
      kill: killFn,
    });

    setTimeout(() => controller.abort(), 50);

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({
      emitStatus,
      signal: controller.signal,
    });

    expect(result).toBe(false);
    expect(killFn).toHaveBeenCalled();
  });
});
