import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:child_process
// ---------------------------------------------------------------------------

type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string,
) => void;

const mockExecFile = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    default: {
      ...(actual as Record<string, unknown>),
      execFile: (...args: unknown[]) => mockExecFile(...args),
    },
    execFile: (...args: unknown[]) => mockExecFile(...args),
  };
});

import { runClaudeLogin, checkAuthStatus } from "@/lib/claude-login";

describe("checkAuthStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed stdout on success", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "  Logged in as user@example.com  \n", "");
      },
    );

    const result = await checkAuthStatus();
    expect(result).toBe("Logged in as user@example.com");
  });

  it("rejects with stderr on failure", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(new Error("exit code 1"), "", "Not authenticated");
      },
    );

    await expect(checkAuthStatus()).rejects.toThrow("Not authenticated");
  });
});

describe("runClaudeLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true on successful login", async () => {
    // First call: auth status check
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "Not authenticated", "");
      },
    );
    // Second call: auth login
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "Login successful!", "");
        return { kill: vi.fn() };
      },
    );

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({ emitStatus });

    expect(result).toBe(true);
    expect(emitStatus).toHaveBeenCalledWith("Login completed successfully!");
  });

  it("returns false when login fails", async () => {
    // Status check
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "Not authenticated", "");
      },
    );
    // Login failure
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(new Error("auth failed"), "", "Authentication error");
        return { kill: vi.fn() };
      },
    );

    const emitStatus = vi.fn();
    const result = await runClaudeLogin({ emitStatus });

    expect(result).toBe(false);
    expect(emitStatus).toHaveBeenCalledWith(
      expect.stringContaining("Authentication error"),
    );
  });

  it("handles auth status check failure gracefully", async () => {
    // Status check fails
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(new Error("not found"), "", "command not found");
      },
    );
    // Login succeeds
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "Logged in", "");
        return { kill: vi.fn() };
      },
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
    const mockKill = vi.fn();

    // Status check
    mockExecFile.mockImplementationOnce(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, "Not authenticated", "");
      },
    );
    // Login — simulate long-running process
    mockExecFile.mockImplementationOnce(() => {
      // Abort immediately
      setTimeout(() => controller.abort(), 10);
      return { kill: mockKill };
    });

    const result = await runClaudeLogin({
      emitStatus: vi.fn(),
      signal: controller.signal,
    });

    expect(result).toBe(false);
    expect(mockKill).toHaveBeenCalled();
  });
});
