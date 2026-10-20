import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sh as exec } from "../../fixtures/sh";
import {
  expandConstraintCommand,
  resolveConstraintScope,
  usesScope,
  type ConstraintScope,
} from "@/lib/workspace/constraint-scope";

const SCOPE: ConstraintScope = {
  base: "abc123",
  changedFiles: ["pkg/a/x.go", "web/it's.ts"],
  baseFiles: ["pkg/a/x.go"],
};

describe("usesScope", () => {
  it("detects either placeholder", () => {
    expect(usesScope("golangci-lint run --new-from-rev={base}")).toBe(true);
    expect(usesScope("eslint {changed_files}")).toBe(true);
    expect(usesScope("make lint")).toBe(false);
  });
});

describe("expandConstraintCommand", () => {
  it("runs a command without placeholders as written, whatever the scope", () => {
    expect(expandConstraintCommand({ label: "Lint", command: "make lint" }, null, "head")).toEqual({
      kind: "run",
      command: "make lint",
    });
  });

  it("substitutes the merge-base and shell-quotes each changed file", () => {
    const c = { label: "Lint", command: "lint --since {base} -- {changed_files}" };
    expect(expandConstraintCommand(c, SCOPE, "head")).toEqual({
      kind: "run",
      command: `lint --since abc123 -- 'pkg/a/x.go' 'web/it'\\''s.ts'`,
    });
  });

  it("passes only files that exist at the merge-base on the base side", () => {
    const c = { label: "Lint", command: "eslint {changed_files}" };
    expect(expandConstraintCommand(c, SCOPE, "base")).toEqual({
      kind: "run",
      command: "eslint 'pkg/a/x.go'",
    });
  });

  it("falls back to the full command when the scope is unknown", () => {
    const c = { label: "Lint", command: "eslint {changed_files}", fullCommand: "pnpm lint" };
    expect(expandConstraintCommand(c, null, "head")).toEqual({ kind: "run", command: "pnpm lint" });
  });

  it("skips a scoped command with no full command when the scope is unknown", () => {
    const c = { label: "Lint", command: "eslint {changed_files}" };
    expect(expandConstraintCommand(c, null, "head").kind).toBe("skip");
  });

  it("skips a file-list command when no file is in scope, rather than letting an empty list mean everything", () => {
    const c = { label: "Lint", command: "eslint {changed_files}", fullCommand: "pnpm lint" };
    const scope = { ...SCOPE, changedFiles: [], baseFiles: [] };
    expect(expandConstraintCommand(c, scope, "head").kind).toBe("skip");
  });

  it("still runs a base-only command when no file changed", () => {
    const c = { label: "Lint", command: "turbo run lint --filter=...[{base}]" };
    const scope = { ...SCOPE, changedFiles: [], baseFiles: [] };
    expect(expandConstraintCommand(c, scope, "head")).toEqual({
      kind: "run",
      command: "turbo run lint --filter=...[abc123]",
    });
  });
});

describe("resolveConstraintScope", () => {
  let root: string;
  let repo: string;

  function git(cmd: string) {
    return exec(`git -C "${repo}" ${cmd}`);
  }

  function write(rel: string, content: string) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join("/tmp", "aiw-constraint-scope-"));
    const origin = path.join(root, "origin");
    repo = path.join(root, "repo");
    exec(`git init -q -b main "${origin}"`);
    exec(`git -C "${origin}" -c user.email=t@t.t -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m init`);
    fs.writeFileSync(path.join(origin, "kept.ts"), "1\n");
    fs.writeFileSync(path.join(origin, "moved.ts"), "1\n");
    fs.writeFileSync(path.join(origin, "gone.ts"), "1\n");
    exec(`git -C "${origin}" add -A`);
    exec(`git -C "${origin}" -c user.email=t@t.t -c user.name=t -c commit.gpgsign=false commit -q -m files`);
    exec(`git clone -q "${origin}" "${repo}"`);
    git("config user.email t@t.t");
    git("config user.name t");
    git("config commit.gpgsign false");
    git("checkout -q -b feature");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("collects committed, uncommitted and untracked changes, leaving deletions out", async () => {
    write("kept.ts", "2\n");
    git("mv moved.ts renamed.ts");
    git("rm -q gone.ts");
    write("pkg/added.ts", "1\n");
    git("add -A");
    git("commit -q -m change");
    write("pkg/dirty.ts", "1\n");

    const scope = await resolveConstraintScope(repo, "main");
    expect(scope?.base).toBe(git("rev-parse origin/main"));
    expect(scope?.changedFiles.sort()).toEqual(["kept.ts", "pkg/added.ts", "pkg/dirty.ts", "renamed.ts"]);
    expect(scope?.baseFiles).toEqual(["kept.ts"]);
  });

  it("returns null when the base branch has no remote ref", async () => {
    expect(await resolveConstraintScope(repo, "no-such-branch")).toBeNull();
  });
});
