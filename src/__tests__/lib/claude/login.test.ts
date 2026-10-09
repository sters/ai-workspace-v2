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
const mockCheckAuthStatus = vi.fn();

vi.mock("@/lib/claude/login", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/claude/login")>();

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
      // Delegate to mockCheckAuthStatus if it has an implementation,
      // otherwise fall through to the spawn-based implementation
      if (mockCheckAuthStatus.getMockImplementation()) {
        return mockCheckAuthStatus();
      }
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
  };
});

import { buildClaudeLoginPhase } from "@/lib/pipelines/actions/claude-login";

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAuthStatus.mockReset();
});

describe("buildClaudeLoginPhase", () => {
  function makeMockCtx(signalOverride?: AbortSignal) {
    return {
      operationId: "test-op",
      emitStatus: vi.fn(),
      emitResult: vi.fn(),
      emitAsk: vi.fn(),
      setWorkspace: vi.fn(),
      runChild: vi.fn(),
      runChildGroup: vi.fn(),
      emitTerminal: vi.fn(),
      signal: signalOverride ?? new AbortController().signal,
    };
  }

  it("returns true on successful login", async () => {
    // checkAuthStatus
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc('{"loggedIn":false}', "", 0),
    );
    // auth login
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("Login successful!", "", 0),
    );

    const phase = buildClaudeLoginPhase();
    const ctx = makeMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.emitStatus).toHaveBeenCalledWith("Login completed successfully!");
    expect(mockSpawnClaudeAuth).toHaveBeenCalledWith("login");
  });

  it("returns false when login fails", async () => {
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc('{"loggedIn":false}', "", 0),
    );
    mockSpawnClaudeAuth.mockReturnValueOnce(
      mockProc("", "Authentication error", 1),
    );

    const phase = buildClaudeLoginPhase();
    const ctx = makeMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(false);
    expect(ctx.emitStatus).toHaveBeenCalledWith(
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

    const phase = buildClaudeLoginPhase();
    const ctx = makeMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.emitStatus).toHaveBeenCalledWith(
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

    const phase = buildClaudeLoginPhase();
    const ctx = makeMockCtx(controller.signal);
    const result = await phase.fn(ctx);

    expect(result).toBe(false);
    expect(killFn).toHaveBeenCalled();
  });
});
