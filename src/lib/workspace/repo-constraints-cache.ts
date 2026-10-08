/**
 * Discovered repository constraints, kept per clone so a later workspace of the
 * same repository reuses them instead of spawning discovery again.
 *
 * One file per clone at `.ai-workspace/repo-constraints/<repo path>.md`, so a
 * worktree and an aliased worktree of the same clone share it. The file carries
 * a key computed from the files discovery reads (task runners, root docs,
 * version pins, the command-bearing parts of manifests); an entry is served only
 * while a new worktree computes the same key. That is checked when a workspace
 * is set up rather than when the clone is fetched: the fetch updates refs
 * without checking anything out, and a key over a tree nobody reads would be
 * work for nothing.
 *
 * The recorded invocations also depend on this machine's toolchain (an exec
 * prefix the probe settled on), which no key over the repository can see.
 * Deleting the file is how that kind of staleness is cleared, and editing a
 * command in it is kept until the key moves.
 */

import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getResolvedWorkspaceRoot } from "@/lib/config/resolver";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";
import { parseConstraintLines, type RepoConstraint } from "@/lib/parsers/readme";
import { repoDir } from "./helpers";
import { runGit, type GitExec } from "./git-exec";

export interface RepoConstraintsCacheEntry {
  file: string;
  key: string;
}

/** Bump when the fingerprint rules change, so entries keyed by the old rules miss. */
const FINGERPRINT_VERSION = "v1";

/** Hashed whole: any change can change which command a repository documents. */
const HASHED_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "Makefile",
  "GNUmakefile",
  "makefile",
  "Taskfile.yml",
  "Taskfile.yaml",
  "justfile",
  "Justfile",
  ".tool-versions",
  "mise.toml",
  ".mise.toml",
  ".node-version",
  ".nvmrc",
  ".python-version",
  ".ruby-version",
  ".go-version",
  ".java-version",
  ".sdkmanrc",
  "rust-toolchain",
  "rust-toolchain.toml",
  "aqua.yaml",
  ".aqua",
  "pyproject.toml",
  "lefthook.yml",
  ".pre-commit-config.yaml",
  ".github/workflows",
];

/**
 * Only whether these exist: their presence picks the dependency manager, while
 * their contents move on every dependency bump and say nothing about commands.
 */
const PRESENCE_PATHS = new Set([
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "yarn.lock",
  "package-lock.json",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "composer.lock",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "go.work",
]);

/**
 * Manifests that also list dependencies: keyed on the parts that decide
 * commands and tool versions, so a dependency bump does not cost a rediscovery.
 */
const SELECTED_PATHS: [string, (content: string) => string][] = [
  [
    "package.json",
    (content) => {
      try {
        const pkg = JSON.parse(content) as Record<string, unknown>;
        return JSON.stringify([pkg.scripts, pkg.packageManager, pkg.engines, pkg.workspaces]);
      } catch {
        return content;
      }
    },
  ],
  [
    "go.mod",
    (content) =>
      content
        .split("\n")
        .filter((line) => /^(go|toolchain)\s/.test(line))
        .join("\n"),
  ],
];

const KEY_PATTERN = /^<!-- aiw-repo-constraints key=([0-9a-f]+) -->$/m;

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

async function fingerprint(worktreePath: string, git: GitExec): Promise<string | null> {
  const tree = await git(
    ["ls-tree", "HEAD", "--", ...HASHED_PATHS, ...PRESENCE_PATHS],
    worktreePath,
  );
  if (!tree.ok) return null;

  const parts = [FINGERPRINT_VERSION];
  for (const line of tree.out.split("\n").filter(Boolean)) {
    const [meta, entryPath] = line.split("\t");
    const hash = meta.split(" ")[2];
    parts.push(PRESENCE_PATHS.has(entryPath) ? `present ${entryPath}` : `${hash} ${entryPath}`);
  }
  for (const [entryPath, select] of SELECTED_PATHS) {
    const shown = await git(["show", `HEAD:${entryPath}`], worktreePath);
    if (shown.ok) parts.push(`${entryPath} ${select(shown.out)}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/**
 * Where a worktree's clone keeps its constraints, and the key its current
 * checkout computes. `null` when the worktree is not a worktree of a clone
 * under `repositories/`, or its HEAD cannot be read.
 */
export async function locateRepoConstraintsCache(
  worktreePath: string,
  git: GitExec = runGit,
): Promise<RepoConstraintsCacheEntry | null> {
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreePath);
  if (!common.ok || !common.out) return null;

  const cloneDir = await realpathOrSelf(path.dirname(common.out));
  const rel = path.relative(await realpathOrSelf(repoDir()), cloneDir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

  const key = await fingerprint(worktreePath, git);
  if (!key) return null;

  const file = path.join(
    getWorkspaceConfigDir(getResolvedWorkspaceRoot()),
    "repo-constraints",
    `${rel}.md`,
  );
  return { file, key };
}

/** The cached constraints when the entry's key still matches, else `null`. */
export async function readRepoConstraintsCache(entry: RepoConstraintsCacheEntry): Promise<RepoConstraint[] | null> {
  let content: string;
  try {
    content = await readFile(entry.file, "utf8");
  } catch {
    return null;
  }
  if (content.match(KEY_PATTERN)?.[1] !== entry.key) return null;
  const constraints = parseConstraintLines(content);
  return constraints.length > 0 ? constraints : null;
}

function formatConstraintLines(constraints: RepoConstraint[]): string {
  return constraints.map((c) => `- ${c.label}: \`${c.command}\``).join("\n");
}

/** Write via rename, since two workspaces of one repository may finish discovery together. */
export async function writeRepoConstraintsCache(
  entry: RepoConstraintsCacheEntry,
  constraints: RepoConstraint[],
): Promise<void> {
  const content = [
    `<!-- aiw-repo-constraints key=${entry.key} -->`,
    "<!-- Reused by every new workspace of this repository while the key matches its build files. Edit a command to correct it; delete this file to have the next workspace rediscover them. -->",
    "",
    formatConstraintLines(constraints),
    "",
  ].join("\n");
  await mkdir(path.dirname(entry.file), { recursive: true });
  const tmp = `${entry.file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, entry.file);
}

export async function cachedRepoConstraints(worktreePath: string): Promise<RepoConstraint[] | null> {
  const entry = await locateRepoConstraintsCache(worktreePath);
  return entry ? await readRepoConstraintsCache(entry) : null;
}

/**
 * Add one repository's block to `## Repository Constraints`, in the format
 * discovery writes, creating the section when the README has none.
 */
export function appendRepoConstraints(
  readme: string,
  repoName: string,
  constraints: RepoConstraint[],
): string {
  const block = `### ${repoName}\n\n${formatConstraintLines(constraints)}\n`;
  const heading = readme.match(/^## Repository Constraints[ \t]*$/m);
  if (!heading) {
    return `${readme.replace(/\n*$/, "")}\n\n## Repository Constraints\n\n${block}`;
  }

  const start = heading.index! + heading[0].length;
  const next = readme.slice(start).match(/\n## |\n# /);
  const end = next ? start + next.index! : readme.length;
  const section = readme.slice(start, end).replace(/\s*$/, "");
  const rest = next ? `\n${readme.slice(end + 1)}` : "";
  return `${readme.slice(0, start)}${section}\n\n${block}${rest}`;
}
