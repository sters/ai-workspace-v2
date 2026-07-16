import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectBaseBranch, remoteBranchExists, exec } from "@/lib/workspace/helpers";

/**
 * These tests build a real "remote" bare repo whose default branch is `master`
 * (not `main`), clone it, and assert branch-detection helpers behave against
 * actual git remote-tracking refs — the scenario behind the
 * `fatal: invalid reference: origin/main` worktree failure.
 */
describe("branch detection helpers", () => {
  let tmpDir: string;
  let remoteDir: string;
  let cloneDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join("/tmp", "aiw-helpers-test-"));
    remoteDir = path.join(tmpDir, "remote.git");
    cloneDir = path.join(tmpDir, "clone");

    // A bare "remote" with a single `master` branch and a committed HEAD.
    const work = path.join(tmpDir, "seed");
    fs.mkdirSync(work, { recursive: true });
    exec(`git init -q -b master "${work}"`);
    exec(`git -C "${work}" config user.email t@t.t`);
    exec(`git -C "${work}" config user.name t`);
    fs.writeFileSync(path.join(work, "f.txt"), "hi");
    exec(`git -C "${work}" add -A`);
    exec(`git -C "${work}" commit -q -m init`);
    exec(`git clone -q --bare "${work}" "${remoteDir}"`);
    exec(`git -C "${remoteDir}" symbolic-ref HEAD refs/heads/master`);

    exec(`git clone -q "${remoteDir}" "${cloneDir}"`);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("remoteBranchExists is true for an existing remote branch", () => {
    expect(remoteBranchExists(cloneDir, "master")).toBe(true);
  });

  it("remoteBranchExists is false for a branch the remote does not have", () => {
    expect(remoteBranchExists(cloneDir, "main")).toBe(false);
  });

  it("detectBaseBranch resolves the remote default branch (master)", () => {
    expect(detectBaseBranch(cloneDir)).toBe("master");
  });
});
