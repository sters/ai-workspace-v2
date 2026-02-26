import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpawnVersion = vi.fn();
vi.mock("@/lib/claude/version", () => ({
  spawnVersion: (...args: unknown[]) => mockSpawnVersion(...args),
}));

beforeEach(() => {
  mockSpawnVersion.mockReset();
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

    mockSpawnVersion.mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      exited: Promise.resolve(0),
    });

    const { GET } = await import("@/app/api/claude-version/route");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.version).toBe("claude-code 1.0.20 (Claude Code)");
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

    mockSpawnVersion.mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      exited: Promise.resolve(1),
    });

    const { GET } = await import("@/app/api/claude-version/route");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
  });

  it("returns error when spawn throws", async () => {
    mockSpawnVersion.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const { GET } = await import("@/app/api/claude-version/route");
    const response = await GET();
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.error).toContain("spawn failed");
  });
});
