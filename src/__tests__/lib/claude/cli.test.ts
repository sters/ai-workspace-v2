import { vi, describe, it, expect, beforeEach, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock config (needed by spawnClaude/runClaudeCommand)
vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/mock/workspace-root",
  getConfig: () => ({ claude: { path: null } }),
}));

const mockSpawnTerminal = vi.fn();
vi.mock("@/lib/pty", () => ({
  spawnTerminal: (...args: unknown[]) => mockSpawnTerminal(...args),
}));

const mockWhich = vi.fn();
const mockSpawn = vi.fn();

const originalWhich = Bun.which;
const originalSpawn = Bun.spawn;
const originalClaudePath = process.env.AIW_CLAUDE_PATH;

// Override Bun globals before importing the module
Bun.which = mockWhich as typeof Bun.which;
Bun.spawn = mockSpawn as typeof Bun.spawn;

const {
  getCliPath,
  _resetCliPath,
  detectFatalApiError,
  getClaudeEnv,
  spawnClaude,
  runClaudeCommand,
  spawnClaudeTerminal,
  runClaude,
} = await import("@/lib/claude/cli");

afterAll(() => {
  Bun.which = originalWhich;
  Bun.spawn = originalSpawn;
  if (originalClaudePath !== undefined) {
    process.env.AIW_CLAUDE_PATH = originalClaudePath;
  } else {
    delete process.env.AIW_CLAUDE_PATH;
  }
  _resetCliPath();
});

describe("getCliPath", () => {
  let tmp: string;

  beforeEach(() => {
    _resetCliPath();
    mockWhich.mockReset();
    delete process.env.AIW_CLAUDE_PATH;
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aiw-cli-path-")));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves the symlink Bun.which returns to the file it points at", () => {
    const target = path.join(tmp, "cli.js");
    fs.writeFileSync(target, "");
    const link = path.join(tmp, "claude");
    fs.symlinkSync(target, link);
    mockWhich.mockReturnValue(link);

    expect(getCliPath()).toBe(target);
    expect(mockWhich).toHaveBeenCalledWith("claude");
  });

  it("falls back to the raw bin path when it cannot be resolved", () => {
    mockWhich.mockReturnValue(path.join(tmp, "missing", "claude"));

    expect(getCliPath()).toBe(path.join(tmp, "missing", "claude"));
  });

  it("returns 'claude' when Bun.which returns null", () => {
    mockWhich.mockReturnValue(null);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getCliPath()).toBe("claude");

    spy.mockRestore();
  });

  it("caches the result (lazy evaluation)", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");

    const first = getCliPath();
    const second = getCliPath();
    expect(first).toBe(second);
    expect(mockWhich).toHaveBeenCalledTimes(1);
  });

  it("uses CLAUDE_PATH env var when set", () => {
    process.env.AIW_CLAUDE_PATH = "/custom/path/to/claude";

    expect(getCliPath()).toBe("/custom/path/to/claude");
    expect(mockWhich).not.toHaveBeenCalled();
  });
});

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

  it("detects 401 case-insensitively", () => {
    const event = {
      type: "result",
      is_error: true,
      errors: ["api error: 401"],
    };
    expect(detectFatalApiError(event)).toBe("api error: 401");
  });
});

describe("getClaudeEnv", () => {
  it("returns env with CLAUDECODE set to undefined", () => {
    const env = getClaudeEnv();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("extra properties override base env", () => {
    const env = getClaudeEnv({ PATH: "/custom/path" });
    expect(env.PATH).toBe("/custom/path");
  });
});

describe("spawnClaude", () => {
  beforeEach(() => {
    _resetCliPath();
    process.env.AIW_CLAUDE_PATH = "/mock/claude";
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
});

describe("runClaudeCommand", () => {
  beforeEach(() => {
    _resetCliPath();
    process.env.AIW_CLAUDE_PATH = "/mock/claude";
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => ({
      stdout: new Response("1.0.0\n").body,
      stderr: new Response("").body,
      exited: Promise.resolve(0),
      kill: vi.fn(),
    }));
  });

  it("runs getCliPath() with the args and resolves with its output", async () => {
    const result = await runClaudeCommand({ args: ["--version"] });

    expect(result).toEqual({ exitCode: 0, success: true, stdout: "1.0.0\n", stderr: "" });
    const [cmd, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toEqual(["/mock/claude", "--version"]);
    expect(opts.cwd).toBe("/mock/workspace-root");
    expect(opts.env.CLAUDECODE).toBeUndefined();
  });

  it("uses provided cwd", async () => {
    await runClaudeCommand({ args: ["mcp", "list"], cwd: "/custom/dir" });

    const [, opts] = mockSpawn.mock.calls[0];
    expect(opts.cwd).toBe("/custom/dir");
  });
});

describe("spawnClaudeTerminal", () => {
  const mockProc = { terminal: { write: vi.fn() }, kill: vi.fn(), exited: Promise.resolve(0) };

  beforeEach(() => {
    _resetCliPath();
    process.env.AIW_CLAUDE_PATH = "/mock/claude";
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

  it("declares a color xterm even when the server has no TERM or a different one", () => {
    const saved = { TERM: process.env.TERM, COLORTERM: process.env.COLORTERM };
    try {
      delete process.env.TERM;
      delete process.env.COLORTERM;
      spawnClaudeTerminal({ args: [], listeners: new Set() });
      process.env.TERM = "tmux-256color";
      spawnClaudeTerminal({ args: [], env: { PATH: "/bin" }, listeners: new Set() });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    for (const [, opts] of mockSpawnTerminal.mock.calls) {
      expect(opts.env.TERM).toBe("xterm-256color");
      expect(opts.env.COLORTERM).toBe("truecolor");
    }
    expect(mockSpawnTerminal.mock.calls[1][1].env.PATH).toBe("/bin");
  });

  it("uses provided cwd", () => {
    const listeners = new Set<(data: string) => void>();
    spawnClaudeTerminal({ args: [], cwd: "/custom/dir", listeners });

    const [, opts] = mockSpawnTerminal.mock.calls[0];
    expect(opts.cwd).toBe("/custom/dir");
  });
});

describe("runClaude", () => {
  function createMockStdout(lines: object[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        }
        controller.close();
      },
    });
  }

  function createEmptyStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({ start(c) { c.close(); } });
  }

  beforeEach(() => {
    _resetCliPath();
    process.env.AIW_CLAUDE_PATH = "/mock/claude";
    mockSpawn.mockReset();
  });

  /** A stdout the test writes to line by line, and a stdin that records what was written. */
  function controlledProcess() {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stdout = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const written: string[] = [];
    let exit!: (code: number) => void;
    const proc = {
      stdout,
      stderr: createEmptyStream(),
      stdin: { write: vi.fn((s: string) => { written.push(s); }), flush: vi.fn(), end: vi.fn() },
      exited: new Promise<number>((r) => { exit = r; }),
      kill: vi.fn(),
    };
    return {
      proc,
      emitLine: (line: object) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n")),
      finish: () => { controller.close(); exit(0); },
      sent: () => written.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  const ask = { questions: [{ question: "Which repo?", header: "Repo", options: [{ label: "A", description: "Opt A" }], multiSelect: false }] };

  it("answers the CLI's AskUserQuestion permission request with the person's answers, in the same process", async () => {
    const p = controlledProcess();
    mockSpawn.mockReturnValue(p.proc);

    const claudeProcess = runClaude("test-op-ask", "test prompt");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    claudeProcess.onEvent((event) => events.push(event));

    const args: string[] = mockSpawn.mock.calls[0][0];
    expect(args).toContain("--permission-prompt-tool");
    expect(p.sent()[0]).toEqual({ type: "user", message: { role: "user", content: "test prompt" } });

    p.emitLine({ type: "system", subtype: "init", session_id: "s1" });
    p.emitLine({ type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", id: "ask-1", input: ask }] } });
    p.emitLine({ type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: ask, tool_use_id: "ask-1" } });
    await tick();
    expect(p.sent()).toHaveLength(1);

    expect(claudeProcess.submitAnswer("ask-1", { "Which repo?": "A" })).toBe(true);
    expect(p.sent()[1]).toEqual({
      type: "control_response",
      response: { subtype: "success", request_id: "req-1", response: { behavior: "allow", updatedInput: { ...ask, answers: { "Which repo?": "A" } } } },
    });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(claudeProcess.submitAnswer("ask-1", { "Which repo?": "A" })).toBe(false);

    p.emitLine({ type: "result", subtype: "success", result: "Done" });
    await tick();
    expect(p.proc.stdin.end).toHaveBeenCalled();
    p.finish();
    await tick();
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(events.some((e) => e.type === "output" && JSON.parse(e.data).type === "control_request")).toBe(false);
  });

  it("denies a permission request for any other tool, as -p does", async () => {
    const p = controlledProcess();
    mockSpawn.mockReturnValue(p.proc);
    runClaude("test-op-deny", "test prompt");

    p.emitLine({ type: "control_request", request_id: "req-2", request: { subtype: "can_use_tool", tool_name: "Write", input: {}, tool_use_id: "w-1" } });
    await tick();
    expect(p.sent()[1].response).toMatchObject({ subtype: "success", request_id: "req-2", response: { behavior: "deny" } });
    p.finish();
  });

  it("offers no AskUserQuestion to a child that must not ask", () => {
    const p = controlledProcess();
    mockSpawn.mockReturnValue(p.proc);
    runClaude("test-op-skip", "test prompt", { skipAskUserQuestion: true });
    expect(mockSpawn.mock.calls[0][0]).not.toContain("--permission-prompt-tool");
    p.finish();
  });

  it("emits tool results and completes when the CLI exits", async () => {
    mockSpawn.mockReturnValue({
      stdout: createMockStdout([
        { type: "system", subtype: "init", session_id: "test-session-2", model: "claude-3" },
        {
          type: "assistant",
          message: {
            content: [{
              type: "tool_use",
              name: "Bash",
              id: "bash-1",
              input: { command: "ls" },
            }],
          },
        },
        {
          type: "user",
          message: {
            content: [{
              type: "tool_result",
              tool_use_id: "bash-1",
              content: "file1.txt\nfile2.txt",
              is_error: false,
            }],
          },
        },
        { type: "result", subtype: "success", result: "Done", total_cost_usd: 0.01, duration_ms: 1000 },
      ]),
      stderr: createEmptyStream(),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });

    const claudeProcess = runClaude("test-op-normal", "test prompt");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    claudeProcess.onEvent((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const outputEvents = events.filter((e) => e.type === "output");
    const parsedOutputs = outputEvents.map((e) => JSON.parse(e.data));

    expect(parsedOutputs.some((p) => p.type === "user")).toBe(true);

    // Complete event should be emitted (no pending ask)
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("stamps the requested effort onto the system init event", async () => {
    mockSpawn.mockReturnValue({
      stdout: createMockStdout([
        { type: "system", subtype: "init", session_id: "test-session-3", model: "claude-opus-5" },
        { type: "result", subtype: "success", result: "Done" },
      ]),
      stderr: createEmptyStream(),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });

    const claudeProcess = runClaude("test-op-effort", "test prompt", { effort: "xhigh" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    claudeProcess.onEvent((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const init = events
      .filter((e) => e.type === "output")
      .map((e) => JSON.parse(e.data))
      .find((p) => p.type === "system" && p.subtype === "init");
    expect(init.effort).toBe("xhigh");
  });

  it("leaves the init event untouched when no effort was requested", async () => {
    mockSpawn.mockReturnValue({
      stdout: createMockStdout([
        { type: "system", subtype: "init", session_id: "test-session-4", model: "claude-opus-5" },
        { type: "result", subtype: "success", result: "Done" },
      ]),
      stderr: createEmptyStream(),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    });

    const claudeProcess = runClaude("test-op-no-effort", "test prompt");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    claudeProcess.onEvent((event) => events.push(event));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const init = events
      .filter((e) => e.type === "output")
      .map((e) => JSON.parse(e.data))
      .find((p) => p.type === "system" && p.subtype === "init");
    expect(init.effort).toBeUndefined();
  });
});
