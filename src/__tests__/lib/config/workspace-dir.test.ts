import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  getWorkspaceConfigDir,
  getWorkspaceDbPath,
  getWorkspaceConfigFilePath,
} from "@/lib/config/workspace-dir";

describe("getWorkspaceConfigDir", () => {
  it("returns .ai-workspace under workspace root", () => {
    const dir = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(dir).toBe("/home/user/my-workspace/.ai-workspace");
  });

  it("is deterministic for the same path", () => {
    const a = getWorkspaceConfigDir("/home/user/my-workspace");
    const b = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(a).toBe(b);
  });

  it("normalizes trailing slash via path.resolve", () => {
    const a = getWorkspaceConfigDir("/home/user/my-workspace");
    const b = getWorkspaceConfigDir("/home/user/my-workspace/");
    expect(a).toBe(b);
  });
});

describe("getWorkspaceDbPath", () => {
  it("returns db.sqlite inside workspace config dir", () => {
    const dbPath = getWorkspaceDbPath("/home/user/my-workspace");
    const configDir = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(dbPath).toBe(path.join(configDir, "db.sqlite"));
  });
});

describe("getWorkspaceConfigFilePath", () => {
  it("returns config.yml inside workspace config dir", () => {
    const configPath = getWorkspaceConfigFilePath("/home/user/my-workspace");
    const configDir = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(configPath).toBe(path.join(configDir, "config.yml"));
  });
});
