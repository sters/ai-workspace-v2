import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock spawn-claude-auth (separate module so internal refs are replaced)
// ---------------------------------------------------------------------------

const mockSpawnClaudeAuth = vi.fn();

vi.mock("@/lib/spawn-claude-auth", () => ({
  spawnClaudeAuth: (...args: unknown[]) => mockSpawnClaudeAuth(...args),
}));

import { runClaudeLogin, checkAuthStatus } from "@/lib/claude-login";

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
