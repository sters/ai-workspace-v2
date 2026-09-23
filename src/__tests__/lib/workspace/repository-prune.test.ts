import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetConfig, _resetWorkspaceRoot, setWorkspaceRoot } from "@/lib/config";
import { exec } from "@/lib/workspace/helpers";
import {
  listRepositoryPruneCandidates,
  listRepositoryUsage,
  pruneRepositories,
} from "@/lib/workspace/repository-prune";

/**
 * These build real clones and real `git worktree add` registrations, because
 * the question the module answers — is anything still using this clone — is
 * answered out of git's own worktree list.
 */
let root: string;
let reposDir: string;
let wsDir: string;

/** A bare repo to clone from, so the clone gets a remote and a default branch. */
function seedRemote(name: string): string {
  const work = path.join(root, "seed", name);
  const bare = path.join(root, "seed", `${name}.git`);
  fs.mkdirSync(work, { recursive: true });
  exec(`git init -q -b main "${work}"`);
  exec(`git -C "${work}" config user.email t@t.t`);
  exec(`git -C "${work}" config user.name t`);
  fs.writeFileSync(path.join(work, "f.txt"), "hi");
  exec(`git -C "${work}" add -A`);
  exec(`git -C "${work}" commit -q -m init`);
  exec(`git clone -q --bare "${work}" "${bare}"`);
  return bare;
}

/** Clone `name` into `repositories/github.com/acme/<name>` and return its path. */
function cloneRepository(name: string): string {
  const bare = seedRemote(name);
  const abs = path.join(reposDir, "github.com", "acme", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  exec(`git clone -q "${bare}" "${abs}"`);
  return abs;
}

/** Add a worktree of `name` into `workspace/<workspace>/github.com/acme/<dirName>`. */
function addWorktree(name: string, workspace: string, dirName = name): string {
  const repoAbs = path.join(reposDir, "github.com", "acme", name);
  const worktree = path.join(wsDir, workspace, "github.com", "acme", dirName);
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  exec(`git -C "${repoAbs}" worktree add -q -b "wt-${workspace}-${dirName}" "${worktree}" main`);
  return worktree;
}

function setMtime(target: string, iso: string) {
  const when = new Date(iso);
  fs.utimesSync(target, when, when);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join("/tmp", "aiw-repo-prune-"));
  reposDir = path.join(root, "repositories");
  wsDir = path.join(root, "workspace");
  fs.mkdirSync(reposDir, { recursive: true });
  fs.mkdirSync(wsDir, { recursive: true });
  setWorkspaceRoot(root);
  _resetConfig();
});

afterEach(() => {
  _resetConfig();
  _resetWorkspaceRoot();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("listRepositoryUsage", () => {
  it("does not count the clone's own main worktree", () => {
    cloneRepository("alpha");
    expect(listRepositoryUsage("github.com/acme/alpha")).toEqual([]);
  });

  it("names the workspace holding a worktree", () => {
    cloneRepository("alpha");
    const worktree = addWorktree("alpha", "feature-x-20260101");

    expect(listRepositoryUsage("github.com/acme/alpha")).toEqual([
      // Resolved, since `/tmp` is a symlink on macOS and git reports the target.
      { workspace: "feature-x-20260101", worktreePath: fs.realpathSync(worktree) },
    ]);
  });

  it("counts an aliased worktree directory as usage of the clone it came from", () => {
    cloneRepository("alpha");
    addWorktree("alpha", "feature-x-20260101", "alpha___dev");

    const usage = listRepositoryUsage("github.com/acme/alpha");
    expect(usage).toHaveLength(1);
    expect(usage[0].workspace).toBe("feature-x-20260101");
  });

  it("ignores a registration whose worktree directory is gone", () => {
    cloneRepository("alpha");
    const worktree = addWorktree("alpha", "feature-x-20260101");
    fs.rmSync(worktree, { recursive: true, force: true });

    expect(listRepositoryUsage("github.com/acme/alpha")).toEqual([]);
  });

  it("throws when the clone cannot be read, so callers cannot mistake it for unused", () => {
    const abs = path.join(reposDir, "github.com", "acme", "broken");
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, ".git"), "not a gitfile");

    expect(() => listRepositoryUsage("github.com/acme/broken")).toThrow();
  });
});

describe("listRepositoryPruneCandidates", () => {
  it("reports nothing when nothing has been cloned", () => {
    expect(listRepositoryPruneCandidates()).toEqual([]);
  });

  it("takes the last reference from the newest signal inside .git, not the directory's own mtime", () => {
    const abs = cloneRepository("alpha");
    setMtime(abs, "2026-01-01T00:00:00.000Z");
    fs.writeFileSync(path.join(abs, ".git", "FETCH_HEAD"), "");
    setMtime(path.join(abs, ".git", "FETCH_HEAD"), "2026-05-05T00:00:00.000Z");
    setMtime(path.join(abs, ".git"), "2026-02-02T00:00:00.000Z");

    const [candidate] = listRepositoryPruneCandidates();
    expect(candidate.lastReferencedAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("orders the least recently referenced first", () => {
    const alpha = cloneRepository("alpha");
    const beta = cloneRepository("beta");
    setMtime(path.join(alpha, ".git"), "2026-06-06T00:00:00.000Z");
    setMtime(alpha, "2026-06-06T00:00:00.000Z");
    setMtime(path.join(beta, ".git"), "2026-01-01T00:00:00.000Z");
    setMtime(beta, "2026-01-01T00:00:00.000Z");

    expect(listRepositoryPruneCandidates().map((c) => c.repoPath)).toEqual([
      "github.com/acme/beta",
      "github.com/acme/alpha",
    ]);
  });

  it("carries the usage that decides whether a row can be ticked", () => {
    cloneRepository("alpha");
    cloneRepository("beta");
    addWorktree("beta", "feature-x-20260101");

    const byPath = new Map(listRepositoryPruneCandidates().map((c) => [c.repoPath, c]));
    expect(byPath.get("github.com/acme/alpha")?.usedBy).toEqual([]);
    expect(byPath.get("github.com/acme/beta")?.usedBy).toHaveLength(1);
  });

  it("reports the read failure instead of an empty usage list", () => {
    const abs = path.join(reposDir, "github.com", "acme", "broken");
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, ".git"), "not a gitfile");

    const [candidate] = listRepositoryPruneCandidates();
    expect(candidate.usageError).toBeTruthy();
  });
});

describe("pruneRepositories", () => {
  it("deletes a clone nothing uses", () => {
    const abs = cloneRepository("alpha");

    expect(pruneRepositories(["github.com/acme/alpha"])).toEqual([
      { repoPath: "github.com/acme/alpha", deleted: true },
    ]);
    expect(fs.existsSync(abs)).toBe(false);
  });

  it("refuses a clone a workspace still has a worktree of, and leaves it on disk", () => {
    const abs = cloneRepository("alpha");
    addWorktree("alpha", "feature-x-20260101");

    const [outcome] = pruneRepositories(["github.com/acme/alpha"]);
    expect(outcome.deleted).toBe(false);
    expect(outcome.reason).toContain("feature-x-20260101");
    expect(fs.existsSync(abs)).toBe(true);
  });

  it("refuses when the worktree list cannot be read", () => {
    const abs = path.join(reposDir, "github.com", "acme", "broken");
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, ".git"), "not a gitfile");

    const [outcome] = pruneRepositories(["github.com/acme/broken"]);
    expect(outcome.deleted).toBe(false);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it("settles each request on its own, so a refusal does not stop the rest", () => {
    const alpha = cloneRepository("alpha");
    const beta = cloneRepository("beta");
    addWorktree("alpha", "feature-x-20260101");

    const outcomes = pruneRepositories(["github.com/acme/alpha", "github.com/acme/beta"]);
    expect(outcomes.map((o) => o.deleted)).toEqual([false, true]);
    expect(fs.existsSync(alpha)).toBe(true);
    expect(fs.existsSync(beta)).toBe(false);
  });

  it("refuses a path that leaves the repositories directory", () => {
    const wsPath = path.join(wsDir, "feature-x-20260101");
    fs.mkdirSync(wsPath, { recursive: true });

    const outcomes = pruneRepositories([
      "../workspace/feature-x-20260101",
      wsPath,
      "",
      ".",
    ]);
    expect(outcomes.every((o) => !o.deleted)).toBe(true);
    expect(fs.existsSync(wsPath)).toBe(true);
    expect(fs.existsSync(reposDir)).toBe(true);
  });

  it("refuses a path that is not a clone", () => {
    const plain = path.join(reposDir, "github.com", "acme", "notes");
    fs.mkdirSync(plain, { recursive: true });

    const [missing, notRepo] = pruneRepositories([
      "github.com/acme/absent",
      "github.com/acme/notes",
    ]);
    expect(missing.deleted).toBe(false);
    expect(notRepo.deleted).toBe(false);
    expect(fs.existsSync(plain)).toBe(true);
  });

  it("clears the org directories the deletion emptied, and keeps the ones still holding a clone", () => {
    cloneRepository("alpha");
    const other = path.join(reposDir, "github.com", "other", "beta");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    exec(`git clone -q "${seedRemote("beta")}" "${other}"`);

    pruneRepositories(["github.com/acme/alpha"]);

    expect(fs.existsSync(path.join(reposDir, "github.com", "acme"))).toBe(false);
    expect(fs.existsSync(path.join(reposDir, "github.com", "other", "beta"))).toBe(true);
    expect(fs.existsSync(reposDir)).toBe(true);
  });
});
