import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

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
  AI_WORKSPACE_ROOT: "/workspace-root",
  getConfig: () => ({ operations: { defaultInteractionLevel: "mid" } }),
}));

async function callPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/claude-settings/add-permission/route");
  const request = new NextRequest(
    "http://localhost:3741/api/claude-settings/add-permission",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
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

describe("POST /api/claude-settings/add-permission", () => {
  it("adds permission to existing settings file", async () => {
    const existing = { permissions: { allow: ["Read"] } };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const { status, data } = await callPOST({ permission: "Bash(rm:*)" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(writtenContent.permissions.allow).toContain("Read");
    expect(writtenContent.permissions.allow).toContain("Bash(rm:*)");
  });

  it("creates new settings file when none exists", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const { status, data } = await callPOST({ permission: "Edit" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(writtenContent.permissions.allow).toContain("Edit");
  });

  it("returns alreadyExists when permission is already in allow list", async () => {
    const existing = { permissions: { allow: ["Read", "Bash(rm:*)"] } };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));

    const { status, data } = await callPOST({ permission: "Bash(rm:*)" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.alreadyExists).toBe(true);
    // Should NOT have written anything
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns 400 when permission is missing", async () => {
    const { status, data } = await callPOST({});
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("returns 400 when permission is not a string", async () => {
    const { status, data } = await callPOST({ permission: 123 });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("preserves existing settings structure when adding permission", async () => {
    const existing = {
      permissions: {
        allow: ["Read"],
        deny: ["WebFetch"],
      },
      env: { FOO: "bar" },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const { status } = await callPOST({ permission: "Bash(ls:*)" });
    expect(status).toBe(200);

    const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(writtenContent.permissions.allow).toEqual(["Read", "Bash(ls:*)"]);
    expect(writtenContent.permissions.deny).toEqual(["WebFetch"]);
    expect(writtenContent.env).toEqual({ FOO: "bar" });
  });

  it("returns 500 when write fails", async () => {
    const existing = { permissions: { allow: [] } };
    mockReadFile.mockResolvedValue(JSON.stringify(existing));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockRejectedValue(new Error("permission denied"));

    const { status, data } = await callPOST({ permission: "Edit" });
    expect(status).toBe(500);
    expect(data.error).toContain("permission denied");
  });
});
