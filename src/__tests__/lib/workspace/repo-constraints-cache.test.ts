import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetConfig, _resetWorkspaceRoot, setWorkspaceRoot } from "@/lib/config";
import { sh as exec } from "../../fixtures/sh";
import { parseConstraints } from "@/lib/parsers/readme";
import { buildReadmeContent } from "@/lib/templates";
import {
  appendRepoConstraints,
  cachedRepoConstraints,
  locateRepoConstraintsCache,
  readRepoConstraintsCache,
  writeRepoConstraintsCache,
} from "@/lib/workspace/repo-constraints-cache";

/**
 * Real clones and worktrees: the key is computed from git trees, and the cache
 * location from the clone a worktree belongs to, so a stubbed git would only
 * test the stub.
 */
let root: string;
let clone: string;

const LINT = [{ label: "Lint", command: "make lint" }];

function git(cwd: string, cmd: string) {
  exec(`git -C "${cwd}" ${cmd}`);
}

function initRepo(dir: string) {
  exec(`git init -q -b main "${dir}"`);
  git(dir, "config user.email t@t.t");
  git(dir, "config user.name t");
  // A host-level signing setup costs a second or more per commit.
  git(dir, "config commit.gpgsign false");
}

function commit(cwd: string, files: Record<string, string | null>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel);
    if (content === null) {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  git(cwd, "add -A");
  git(cwd, "commit -q -m change");
}

const PACKAGE_JSON = {
  name: "web",
  packageManager: "pnpm@9.0.0",
  scripts: { lint: "eslint .", test: "vitest" },
  dependencies: { react: "18.2.0" },
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join("/tmp", "aiw-constraints-cache-"));
  clone = path.join(root, "repositories", "github.com", "acme", "web");
  fs.mkdirSync(clone, { recursive: true });
  initRepo(clone);
  commit(clone, {
    "Makefile": "lint:\n\techo lint\n",
    "package.json": JSON.stringify(PACKAGE_JSON, null, 2),
    "pnpm-lock.yaml": "lockfileVersion: 9\n",
    "go.mod": "module example.com/web\n\ngo 1.22\n\nrequire example.com/x v1.0.0\n",
    "src/index.ts": "export {};\n",
  });
  fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
  setWorkspaceRoot(root);
  _resetConfig();
});

afterEach(async () => {
  _resetConfig();
  _resetWorkspaceRoot();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A fresh worktree of the clone's current `main`, the way setupRepository cuts one. */
let worktreeSeq = 0;
function addWorktree(dirName = "web"): string {
  worktreeSeq += 1;
  const wt = path.join(root, "workspace", `ws-${worktreeSeq}`, "github.com", "acme", dirName);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(clone, `worktree add -q -b "b-${worktreeSeq}" "${wt}" main`);
  return wt;
}

/**
 * Cache LINT from the current main, commit `change`, and look it up again. The
 * clone's own checkout stands in for a fresh worktree: it resolves to the same
 * entry and computes the key the same way, at a fraction of the git calls.
 */
async function cacheThenLookUp(change?: Record<string, string | null>) {
  const first = await locateRepoConstraintsCache(clone);
  expect(first).not.toBeNull();
  await writeRepoConstraintsCache(first!, LINT);
  if (change) commit(clone, change);
  return await cachedRepoConstraints(clone);
}

// Real git under a loaded machine can outrun the default 5s.
describe("repo constraints cache", { timeout: 30_000 }, () => {
  it("serves a later worktree of the same repository", async () => {
    await writeRepoConstraintsCache((await locateRepoConstraintsCache(addWorktree()))!, LINT);
    expect(await cachedRepoConstraints(addWorktree())).toEqual(LINT);
  });

  it("keeps serving across changes to files discovery does not read", async () => {
    expect(await cacheThenLookUp({ "src/index.ts": "export const x = 1;\n" })).toEqual(LINT);
  });

  it("misses once a task runner changes", async () => {
    expect(await cacheThenLookUp({ Makefile: "lint:\n\tgolangci-lint run\n" })).toBeNull();
  });

  it("misses once a root doc that documents the commands changes", async () => {
    expect(await cacheThenLookUp({ "CLAUDE.md": "Run `make lint` before committing.\n" })).toBeNull();
  });

  it("ignores a dependency bump in package.json", async () => {
    const bumped = { ...PACKAGE_JSON, dependencies: { react: "18.3.0" } };
    expect(await cacheThenLookUp({ "package.json": JSON.stringify(bumped, null, 2) })).toEqual(LINT);
  });

  it("misses once a package.json script changes", async () => {
    const rescripted = { ...PACKAGE_JSON, scripts: { lint: "biome check ." } };
    expect(await cacheThenLookUp({ "package.json": JSON.stringify(rescripted, null, 2) })).toBeNull();
  });

  it("ignores a require bump in go.mod", async () => {
    expect(
      await cacheThenLookUp({ "go.mod": "module example.com/web\n\ngo 1.22\n\nrequire example.com/x v1.1.0\n" }),
    ).toEqual(LINT);
  });

  it("misses once the go directive changes", async () => {
    expect(await cacheThenLookUp({ "go.mod": "module example.com/web\n\ngo 1.23\n" })).toBeNull();
  });

  it("ignores a lockfile's contents", async () => {
    expect(await cacheThenLookUp({ "pnpm-lock.yaml": "lockfileVersion: 9\n# bumped\n" })).toEqual(LINT);
  });

  it("misses once the package manager changes", async () => {
    expect(await cacheThenLookUp({ "pnpm-lock.yaml": null, "yarn.lock": "# yarn\n" })).toBeNull();
  });

  it("shares one entry between a worktree and an aliased worktree of the same clone", async () => {
    const plain = await locateRepoConstraintsCache(addWorktree("web"));
    const aliased = await locateRepoConstraintsCache(addWorktree("web___admin"));
    expect(aliased?.file).toBe(plain?.file);
    expect(plain?.file).toBe(
      path.join(root, ".ai-workspace", "repo-constraints", "github.com", "acme", "web.md"),
    );
  });

  it("has no entry for a directory that is not a worktree of a managed clone", async () => {
    const stray = path.join(root, "elsewhere");
    fs.mkdirSync(stray);
    initRepo(stray);
    commit(stray, { Makefile: "lint:\n" });
    expect(await locateRepoConstraintsCache(stray)).toBeNull();
    expect(await locateRepoConstraintsCache(path.join(root, "missing"))).toBeNull();
  });

  it("serves a hand-edited command while the key still matches", async () => {
    const entry = (await locateRepoConstraintsCache(clone))!;
    await writeRepoConstraintsCache(entry, LINT);
    fs.writeFileSync(
      entry.file,
      fs.readFileSync(entry.file, "utf8").replace("make lint", "mise exec -- make lint"),
    );
    expect(await readRepoConstraintsCache(entry)).toEqual([
      { label: "Lint", command: "mise exec -- make lint" },
    ]);
  });

  it("treats a file without a key, or without commands, as a miss", async () => {
    const entry = (await locateRepoConstraintsCache(clone))!;
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    fs.writeFileSync(entry.file, "- Lint: `make lint`\n");
    expect(await readRepoConstraintsCache(entry)).toBeNull();

    await writeRepoConstraintsCache(entry, LINT);
    fs.writeFileSync(entry.file, fs.readFileSync(entry.file, "utf8").replace(/^- .*$/m, ""));
    expect(await readRepoConstraintsCache(entry)).toBeNull();
  });
});

describe("appendRepoConstraints", () => {
  it("adds the block inside the section, readable by the constraint parser", async () => {
    const readme = buildReadmeContent("x", "feature", "", "2026-10-02");

    const once = appendRepoConstraints(readme, "web", LINT);
    const twice = appendRepoConstraints(once, "api", [{ label: "Test", command: "go test ./..." }]);

    expect(parseConstraints(twice)).toEqual([
      { repoName: "web", constraints: LINT },
      { repoName: "api", constraints: [{ label: "Test", command: "go test ./..." }] },
    ]);
    // The section after it is untouched.
    expect(twice).toMatch(/## Repository Constraints[\s\S]*### api[\s\S]*\n## Related Resources/);
  });

  it("creates the section when the README has none", async () => {
    const out = appendRepoConstraints("# Task: x\n\n## Goal\n\ny\n", "web", LINT);
    expect(parseConstraints(out)).toEqual([{ repoName: "web", constraints: LINT }]);
    expect(out.startsWith("# Task: x\n\n## Goal\n\ny\n")).toBe(true);
  });
});
