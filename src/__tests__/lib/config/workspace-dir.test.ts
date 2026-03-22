import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  getWorkspaceConfigDir,
  getWorkspaceDbPath,
  getWorkspaceConfigFilePath,
  CONFIG_BASE_DIR,
} from "@/lib/config/workspace-dir";

describe("CONFIG_BASE_DIR", () => {
  it("points to ~/.config/ai-workspace", () => {
    expect(CONFIG_BASE_DIR).toBe(
      path.join(os.homedir(), ".config", "ai-workspace"),
    );
  });
});

describe("getWorkspaceConfigDir", () => {
  it("returns {basename}-{hash} under CONFIG_BASE_DIR", () => {
    const dir = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(dir).toMatch(/^.*\/\.config\/ai-workspace\/my-workspace-[a-f0-9]{8}$/);
  });

  it("is deterministic for the same path", () => {
    const a = getWorkspaceConfigDir("/home/user/my-workspace");
    const b = getWorkspaceConfigDir("/home/user/my-workspace");
    expect(a).toBe(b);
  });

  it("produces different hashes for different paths", () => {
    const a = getWorkspaceConfigDir("/path/a");
    const b = getWorkspaceConfigDir("/path/b");
    expect(a).not.toBe(b);
  });

  it("normalizes trailing slash via path.resolve", () => {
    const a = getWorkspaceConfigDir("/home/user/my-workspace");
    const b = getWorkspaceConfigDir("/home/user/my-workspace/");
    expect(a).toBe(b);
  });

  it("uses basename of the path", () => {
    const dir = getWorkspaceConfigDir("/deeply/nested/workspace-name");
    expect(path.basename(dir)).toMatch(/^workspace-name-[a-f0-9]{8}$/);
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
