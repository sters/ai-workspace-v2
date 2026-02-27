import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

// Mock config (needed by spawnClaude/spawnClaudeSync)
vi.mock("@/lib/config", () => ({
  AI_WORKSPACE_ROOT: "/mock/workspace-root",
}));

const mockSpawnTerminal = vi.fn();
vi.mock("@/lib/pty", () => ({
  spawnTerminal: (...args: unknown[]) => mockSpawnTerminal(...args),
}));

const mockWhich = vi.fn();
const mockSpawn = vi.fn();
const mockSpawnSync = vi.fn();

// Store originals
const originalWhich = Bun.which;
const originalSpawn = Bun.spawn;
const originalSpawnSync = Bun.spawnSync;
const originalClaudePath = process.env.CLAUDE_PATH;

// Override Bun globals before importing the module
Bun.which = mockWhich as typeof Bun.which;
Bun.spawn = mockSpawn as typeof Bun.spawn;
Bun.spawnSync = mockSpawnSync as typeof Bun.spawnSync;

const {
  getCliPath,
  _resetCliPath,
  detectFatalApiError,
  getClaudeEnv,
  spawnClaude,
  spawnClaudeSync,
  spawnClaudeTerminal,
} = await import("@/lib/claude/cli");

afterAll(() => {
  Bun.which = originalWhich;
  Bun.spawn = originalSpawn;
  Bun.spawnSync = originalSpawnSync;
  if (originalClaudePath !== undefined) {
    process.env.CLAUDE_PATH = originalClaudePath;
  } else {
    delete process.env.CLAUDE_PATH;
  }
  _resetCliPath();
});

// ---------------------------------------------------------------------------
// getCliPath
// ---------------------------------------------------------------------------

describe("getCliPath", () => {
  beforeEach(() => {
    _resetCliPath();
    mockWhich.mockReset();
    mockSpawnSync.mockReset();
    delete process.env.CLAUDE_PATH;
  });

  it("resolves via Bun.which + realpath", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValueOnce({
      success: true,
      stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
      stderr: Buffer.from(""),
    });

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockWhich).toHaveBeenCalledWith("claude");
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to readlink -f when realpath fails", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("realpath failed"),
      })
      .mockReturnValueOnce({
        success: true,
        stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
        stderr: Buffer.from(""),
      });

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  it("falls back to raw bin path when both realpath and readlink fail", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("realpath failed"),
      })
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("readlink failed"),
      });

    expect(getCliPath()).toBe("/usr/local/bin/claude");
  });

  it("returns 'claude' when Bun.which returns null", () => {
    mockWhich.mockReturnValue(null);

    expect(getCliPath()).toBe("claude");
  });

  it("caches the result (lazy evaluation)", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValueOnce({
      success: true,
      stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
      stderr: Buffer.from(""),
    });

    const first = getCliPath();
    const second = getCliPath();
    expect(first).toBe(second);
    // Bun.which should only be called on first invocation
    expect(mockWhich).toHaveBeenCalledTimes(1);
  });

  it("uses CLAUDE_PATH env var when set", () => {
    process.env.CLAUDE_PATH = "/custom/path/to/claude";

    expect(getCliPath()).toBe("/custom/path/to/claude");
    // Should not call Bun.which when CLAUDE_PATH is set
    expect(mockWhich).not.toHaveBeenCalled();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("re-resolves after _resetCliPath()", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValue({
      success: true,
      stdout: Buffer.from("/usr/local/bin/claude\n"),
      stderr: Buffer.from(""),
    });

    getCliPath();
    _resetCliPath();
    getCliPath();

    // Called for both resolutions
    expect(mockWhich).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// detectFatalApiError
// ---------------------------------------------------------------------------

describe("detectFatalApiError", () => {
  it("detects API Error: 401 in result errors", () => {
    const event = {
      type: "result",
      is_error: true,
      errors: ["API Error: 401 Unauthorized"],
    };
    expect(detectFatalApiError(event)).toBe("API Error: 401 Unauthorized");
  });

  it("detects API Error: 401 in result text", () => {
    const event = {
      type: "result",
      result: "API Error: 401",
    };
    expect(detectFatalApiError(event)).toBe("API Error: 401");
  });

  it("detects authentication_failed in assistant error field", () => {
    const event = {
      type: "assistant",
      error: "authentication_failed",
      message: { content: [] },
    };
    expect(detectFatalApiError(event)).toBe("authentication_failed");
  });

  it("detects auth_status error", () => {
    const event = {
      type: "auth_status",
      error: "authentication_failed",
    };
    expect(detectFatalApiError(event)).toBe("authentication_failed");
  });

  it("returns null for normal result events", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "Task completed successfully.",
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("returns null for normal assistant events", () => {
    const event = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("returns null for system events", () => {
    const event = {
      type: "system",
      subtype: "init",
      session_id: "abc",
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("detects 401 case-insensitively", () => {
    const event = {
      type: "result",
      is_error: true,
      errors: ["api error: 401"],
    };
    expect(detectFatalApiError(event)).toBe("api error: 401");
  });
});

// ---------------------------------------------------------------------------
// getClaudeEnv
// ---------------------------------------------------------------------------

describe("getClaudeEnv", () => {
  it("returns env with CLAUDECODE set to undefined", () => {
    const env = getClaudeEnv();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("merges extra properties", () => {
    const env = getClaudeEnv({ CUSTOM_VAR: "hello" });
    expect(env.CUSTOM_VAR).toBe("hello");
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it("extra properties override base env", () => {
    const env = getClaudeEnv({ PATH: "/custom/path" });
    expect(env.PATH).toBe("/custom/path");
  });
});

// ---------------------------------------------------------------------------
// spawnClaude
// ---------------------------------------------------------------------------

describe("spawnClaude", () => {
  beforeEach(() => {
    _resetCliPath();
    process.env.CLAUDE_PATH = "/mock/claude";
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue({
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });
  });

  it("spawns with getCliPath() prefixed to args", () => {
    spawnClaude({ args: ["--version"] });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toEqual(["/mock/claude", "--version"]);
    expect(opts.cwd).toBe("/mock/workspace-root");
    expect(opts.stdout).toBe("pipe");
    expect(opts.stderr).toBe("pipe");
    expect(opts.env.CLAUDECODE).toBeUndefined();
  });

  it("uses provided cwd", () => {
    spawnClaude({ args: ["auth", "status"], cwd: "/custom/dir" });

    const [, opts] = mockSpawn.mock.calls[0];
    expect(opts.cwd).toBe("/custom/dir");
  });

  it("passes stdin option when specified", () => {
    spawnClaude({ args: ["-p", "-"], stdin: "pipe" });

    const [, opts] = mockSpawn.mock.calls[0];
    expect(opts.stdin).toBe("pipe");
  });

  it("uses custom env when provided", () => {
    const customEnv = { PATH: "/bin", CLAUDECODE: undefined };
    spawnClaude({ args: ["--version"], env: customEnv });

    const [, opts] = mockSpawn.mock.calls[0];
    expect(opts.env).toBe(customEnv);
  });
});

// ---------------------------------------------------------------------------
// spawnClaudeSync
// ---------------------------------------------------------------------------

describe("spawnClaudeSync", () => {
  beforeEach(() => {
    _resetCliPath();
    process.env.CLAUDE_PATH = "/mock/claude";
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({
      success: true,
      stdout: Buffer.from("1.0.0\n"),
      stderr: Buffer.from(""),
    });
  });

  it("spawns synchronously with getCliPath() prefixed to args", () => {
    spawnClaudeSync({ args: ["--version"] });

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    const [cmd, opts] = mockSpawnSync.mock.calls[0];
    expect(cmd).toEqual(["/mock/claude", "--version"]);
    expect(opts.cwd).toBe("/mock/workspace-root");
    expect(opts.stdout).toBe("pipe");
    expect(opts.stderr).toBe("pipe");
    expect(opts.env.CLAUDECODE).toBeUndefined();
  });

  it("uses provided cwd", () => {
    spawnClaudeSync({ args: ["mcp", "list"], cwd: "/custom/dir" });

    const [, opts] = mockSpawnSync.mock.calls[0];
    expect(opts.cwd).toBe("/custom/dir");
  });

  it("uses custom env when provided", () => {
    const customEnv = { PATH: "/bin", CLAUDECODE: undefined };
    spawnClaudeSync({ args: ["--version"], env: customEnv });

    const [, opts] = mockSpawnSync.mock.calls[0];
    expect(opts.env).toBe(customEnv);
  });
});

// ---------------------------------------------------------------------------
// spawnClaudeTerminal
// ---------------------------------------------------------------------------

describe("spawnClaudeTerminal", () => {
  const mockProc = { terminal: { write: vi.fn() }, kill: vi.fn(), exited: Promise.resolve(0) };

  beforeEach(() => {
    _resetCliPath();
    process.env.CLAUDE_PATH = "/mock/claude";
    mockSpawnTerminal.mockReset();
    mockSpawnTerminal.mockReturnValue(mockProc);
  });

  it("calls spawnTerminal with getCliPath() prefixed to args", () => {
    const listeners = new Set<(data: string) => void>();
    spawnClaudeTerminal({ args: ["--init-prompt", "hello"], listeners });

    expect(mockSpawnTerminal).toHaveBeenCalledTimes(1);
    const [cmd, opts, passedListeners] = mockSpawnTerminal.mock.calls[0];
    expect(cmd).toEqual(["/mock/claude", "--init-prompt", "hello"]);
    expect(opts.cwd).toBe("/mock/workspace-root");
    expect(opts.env.CLAUDECODE).toBeUndefined();
    expect(passedListeners).toBe(listeners);
  });

  it("uses provided cwd", () => {
    const listeners = new Set<(data: string) => void>();
    spawnClaudeTerminal({ args: [], cwd: "/custom/dir", listeners });

    const [, opts] = mockSpawnTerminal.mock.calls[0];
    expect(opts.cwd).toBe("/custom/dir");
  });

  it("uses custom env when provided", () => {
    const listeners = new Set<(data: string) => void>();
    const customEnv = { PATH: "/bin", CLAUDECODE: undefined };
    spawnClaudeTerminal({ args: [], env: customEnv, listeners });

    const [, opts] = mockSpawnTerminal.mock.calls[0];
    expect(opts.env).toBe(customEnv);
  });

  it("passes cols and rows options", () => {
    const listeners = new Set<(data: string) => void>();
    spawnClaudeTerminal({ args: [], listeners, cols: 80, rows: 24 });

    const [, opts] = mockSpawnTerminal.mock.calls[0];
    expect(opts.cols).toBe(80);
    expect(opts.rows).toBe(24);
  });
});
