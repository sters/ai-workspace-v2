import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/claude-sdk", () => ({
  cliPath: "/mock/bin/claude",
}));

vi.mock("@/lib/config", () => ({
  AI_WORKSPACE_ROOT: "/workspace-root",
}));

// Mock Bun.spawn on globalThis
const mockSpawn = vi.fn();
(globalThis as Record<string, unknown>).Bun = {
  spawn: mockSpawn,
};

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/claude-version/route");
  const response = await mod.GET();
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("GET /api/claude-version", () => {
  it("returns version string on success", async () => {
    const mockStdout = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("claude-code 1.0.20 (Claude Code)\n"));
        controller.close();
      },
    });
    const mockStderr = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      exited: Promise.resolve(0),
    });

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.version).toBe("claude-code 1.0.20 (Claude Code)");
    expect(mockSpawn).toHaveBeenCalledWith(["/mock/bin/claude", "--version"], {
      cwd: "/workspace-root",
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("returns error on non-zero exit code", async () => {
    const mockStdout = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const mockStderr = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("command not found"));
        controller.close();
      },
    });

    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      exited: Promise.resolve(1),
    });

    const { status, data } = await callGET();
    expect(status).toBe(500);
    expect(data.error).toBeDefined();
  });

  it("returns error when spawn throws", async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const { status, data } = await callGET();
    expect(status).toBe(500);
    expect(data.error).toContain("spawn failed");
  });
});
