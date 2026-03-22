import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

// Mock Bun.file() and Bun.write() for the test environment.
// The global Bun object is non-configurable, so we override its properties directly.
const mockBunFile = vi.fn((filePath: string) => ({
  text: () => mockReadFile(filePath),
}));
const mockBunWrite = vi.fn((filePath: string, content: string) =>
  mockWriteFile(filePath, content)
);
const originalBunFile = Bun.file;
const originalBunWrite = Bun.write;
Bun.file = mockBunFile as unknown as typeof Bun.file;
Bun.write = mockBunWrite as unknown as typeof Bun.write;

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
  },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...(actual as Record<string, unknown>),
    default: { ...(actual as Record<string, unknown>), homedir: () => "/mock-home" },
    homedir: () => "/mock-home",
  };
});

vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/workspace-root",
  getResolvedWorkspaceRoot: () => "/workspace-root",
  getConfig: () => ({ operations: { defaultInteractionLevel: "mid" } }),
}));

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/claude-settings/route");
  const response = await mod.GET();
  return { status: response.status, data: await response.json() };
}

async function callPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/claude-settings/route");
  const request = new NextRequest("http://localhost:3741/api/claude-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await mod.POST(request);
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockMkdir.mockReset();
  mockBunFile.mockClear();
  mockBunWrite.mockClear();
});

afterAll(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

describe("GET /api/claude-settings", () => {
  it("returns all settings when all files exist", async () => {
    mockReadFile.mockImplementation(async (filePath: string) => {
      const p = String(filePath);
      if (p.endsWith(".claude/settings.json") && p.startsWith("/workspace-root")) {
        return JSON.stringify({ permissions: { allow: ["Read"] } });
      }
      if (p.endsWith(".claude/settings.local.json")) {
        return JSON.stringify({ permissions: { deny: ["Bash"] } });
      }
      if (p.endsWith(".claude/settings.json") && p.startsWith("/mock-home")) {
        return JSON.stringify({ theme: "dark" });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.settings).toHaveLength(3);

    const project = data.settings.find((s: { scope: string }) => s.scope === "project");
    expect(project.exists).toBe(true);
    expect(JSON.parse(project.content)).toEqual({ permissions: { allow: ["Read"] } });

    const local = data.settings.find((s: { scope: string }) => s.scope === "local");
    expect(local.exists).toBe(true);
    expect(JSON.parse(local.content)).toEqual({ permissions: { deny: ["Bash"] } });

    const user = data.settings.find((s: { scope: string }) => s.scope === "user");
    expect(user.exists).toBe(true);
    expect(JSON.parse(user.content)).toEqual({ theme: "dark" });
  });

  it("returns exists=false for missing files", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.settings).toHaveLength(3);
    for (const s of data.settings) {
      expect(s.exists).toBe(false);
      expect(s.content).toBeNull();
      expect(s.error).toBeNull();
    }
  });

  it("returns error for invalid JSON files", async () => {
    mockReadFile.mockResolvedValue("not valid json {{{");

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.settings).toHaveLength(3);
    for (const s of data.settings) {
      expect(s.exists).toBe(true);
      expect(s.error).toBeDefined();
      expect(s.error).not.toBeNull();
    }
  });
});

describe("POST /api/claude-settings", () => {
  it("writes valid JSON to project settings", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const content = JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2);
    const { status, data } = await callPOST({ scope: "project", content });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining(".claude"),
      { recursive: true }
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(".claude/settings.json"),
      content
    );
  });

  it("writes valid JSON to local settings", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const content = JSON.stringify({ key: "value" });
    const { status, data } = await callPOST({ scope: "local", content });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("settings.local.json"),
      content
    );
  });

  it("writes valid JSON to user settings", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const content = JSON.stringify({ theme: "light" });
    const { status, data } = await callPOST({ scope: "user", content });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("/mock-home/.claude/settings.json"),
      content
    );
  });

  it("returns 400 for invalid scope", async () => {
    const { status, data } = await callPOST({
      scope: "invalid",
      content: "{}",
    });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("returns 400 for invalid JSON content", async () => {
    const { status, data } = await callPOST({
      scope: "project",
      content: "not valid json",
    });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("returns 500 when writeFile fails", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockRejectedValue(new Error("permission denied"));

    const { status, data } = await callPOST({
      scope: "project",
      content: "{}",
    });
    expect(status).toBe(500);
    expect(data.error).toContain("permission denied");
  });
});
