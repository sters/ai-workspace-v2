import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOCK_DANGEROUS_BASH_SH, SESSION_START_GIT_SH } from "@/lib/claude/hooks/scripts";

let tmpDir: string;
let blockPath: string;
let sessionPath: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-hook-scripts-test-"));
  blockPath = path.join(tmpDir, "block.ts");
  sessionPath = path.join(tmpDir, "session.ts");
  fs.writeFileSync(blockPath, BLOCK_DANGEROUS_BASH_SH);
  fs.writeFileSync(sessionPath, SESSION_START_GIT_SH);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function runBlock(payload: Record<string, unknown>): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["bun", blockPath], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout };
}

describe("BLOCK_DANGEROUS_BASH_SH", () => {
  it("denies rm -rf with absolute path", async () => {
    const r = await runBlock({ tool_input: { command: "rm -rf /tmp/foo" } });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allows rm -rf with relative path (e.g. node_modules)", async () => {
    const r = await runBlock({ tool_input: { command: "rm -rf node_modules" } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("denies git push --force", async () => {
    const r = await runBlock({ tool_input: { command: "git push --force origin main" } });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allows git push --force-with-lease", async () => {
    const r = await runBlock({ tool_input: { command: "git push --force-with-lease origin foo" } });
    expect(r.stdout.trim()).toBe("");
  });

  it("denies git reset --hard", async () => {
    const r = await runBlock({ tool_input: { command: "git reset --hard origin/main" } });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allows safe commands", async () => {
    const r = await runBlock({ tool_input: { command: "ls -la" } });
    expect(r.stdout.trim()).toBe("");
  });

  it("fails open when payload is malformed", async () => {
    const proc = Bun.spawn(["bun", blockPath], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write("not json");
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});

describe("SESSION_START_GIT_SH", () => {
  it("emits additionalContext when run in a git repo", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-hook-session-repo-"));
    try {
      Bun.spawnSync(["git", "init", "--quiet", "-b", "main"], { cwd: repo });
      Bun.spawnSync(["git", "-C", repo, "config", "user.email", "t@t"], {});
      Bun.spawnSync(["git", "-C", repo, "config", "user.name", "t"], {});
      fs.writeFileSync(path.join(repo, "a.txt"), "hi");

      const proc = Bun.spawn(["bun", sessionPath], { cwd: repo, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      proc.stdin.write("{}");
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      expect(proc.exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("a.txt");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("emits empty output in non-git directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-hook-session-nongit-"));
    try {
      const proc = Bun.spawn(["bun", sessionPath], { cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      proc.stdin.write("{}");
      proc.stdin.end();
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(proc.exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
