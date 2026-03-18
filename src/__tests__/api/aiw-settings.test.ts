import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

const mockResetConfig = vi.fn();

vi.mock("@/lib/config", () => ({
  CONFIG_FILE_PATH: "/mock-home/.config/ai-workspace/config.yml",
  _resetConfig: () => mockResetConfig(),
}));

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/aiw-settings/route");
  const response = await mod.GET();
  return { status: response.status, data: await response.json() };
}

async function callPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/aiw-settings/route");
  const request = new NextRequest("http://localhost:3741/api/aiw-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await mod.POST(request);
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockResetConfig.mockReset();
});

describe("GET /api/aiw-settings", () => {
  it("returns config content when file exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("workspaceRoot: /path/to/workspace\n");

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.filePath).toBe("/mock-home/.config/ai-workspace/config.yml");
    expect(data.exists).toBe(true);
    expect(data.content).toBe("workspaceRoot: /path/to/workspace\n");
  });

  it("returns exists=false when file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    const { status, data } = await callGET();
    expect(status).toBe(200);
    expect(data.exists).toBe(false);
    expect(data.content).toBeNull();
  });
});

describe("POST /api/aiw-settings", () => {
  it("writes valid YAML and resets config cache", async () => {
    const content = "workspaceRoot: /new/path\nserver:\n  port: 4000\n";
    const { status, data } = await callPOST({ content });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".config/ai-workspace"),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/mock-home/.config/ai-workspace/config.yml",
      content,
      "utf-8",
    );
    expect(mockResetConfig).toHaveBeenCalled();
  });

  it("accepts empty content", async () => {
    const { status, data } = await callPOST({ content: "" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("returns 400 when content is not a string", async () => {
    const { status, data } = await callPOST({ content: 123 });
    expect(status).toBe(400);
    expect(data.error).toContain("content is required");
  });

  it("returns 400 for invalid YAML", async () => {
    const { status, data } = await callPOST({ content: "key: [invalid: yaml:" });
    expect(status).toBe(400);
    expect(data.error).toContain("Invalid YAML");
  });

  it("returns 400 when YAML parses to a non-object", async () => {
    const { status, data } = await callPOST({ content: "just a string" });
    expect(status).toBe(400);
    expect(data.error).toContain("YAML mapping");
  });

  it("accepts YAML comments-only content", async () => {
    const content = "# ai-workspace configuration\n# workspaceRoot: /path\n";
    const { status, data } = await callPOST({ content });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});
