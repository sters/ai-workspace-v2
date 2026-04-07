import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getResolvedWorkspaceRoot: () => "/tmp/unused-workspace-root",
}));

import { ensureSystemPrompt, writeSystemPrompts, _resetVerifiedDirs } from "@/lib/workspace/prompts";

describe("workspace prompts cleanup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join("/tmp", "workspace-prompts-test-"));
    _resetVerifiedDirs();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _resetVerifiedDirs();
  });

  it("writeSystemPrompts removes stale .md files no longer in SYSTEM_PROMPTS", async () => {
    const promptsDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, "researcher.md"), "stale legacy content");
    fs.writeFileSync(path.join(promptsDir, "definitely-removed.md"), "stale");

    await writeSystemPrompts(tmpDir);

    expect(fs.existsSync(path.join(promptsDir, "researcher.md"))).toBe(false);
    expect(fs.existsSync(path.join(promptsDir, "definitely-removed.md"))).toBe(false);
    // A known-current prompt should be present
    expect(fs.existsSync(path.join(promptsDir, "executor.md"))).toBe(true);
  });

  it("writeSystemPrompts preserves the .hash file and non-.md files", async () => {
    const promptsDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, "user-notes.txt"), "keep me");

    await writeSystemPrompts(tmpDir);

    expect(fs.existsSync(path.join(promptsDir, "user-notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(promptsDir, ".hash"))).toBe(true);
  });

  it("ensureSystemPrompt removes stale .md files when regenerating due to hash mismatch", () => {
    const promptsDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, "researcher.md"), "stale legacy");
    // Stale hash file forces regeneration
    fs.writeFileSync(path.join(promptsDir, ".hash"), "stale-hash-value");

    ensureSystemPrompt(tmpDir, "executor");

    expect(fs.existsSync(path.join(promptsDir, "researcher.md"))).toBe(false);
    expect(fs.existsSync(path.join(promptsDir, "executor.md"))).toBe(true);
  });
});
