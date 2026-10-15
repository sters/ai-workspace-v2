/**
 * Where a repository documents how to implement and how to review changes in it
 * (CLAUDE.md, skills, contributing guides, review workflows), as found by the
 * guidance discovery agent.
 *
 * Each workspace holds one file per repository at
 * `artifacts/repo-guidance/<repoName>.md`, with a `## Implementation` and a
 * `## Review` section of bullets naming repository-relative paths. Planners and
 * executors are handed the first section, reviewers the second.
 *
 * The same text is cached per clone at `.ai-workspace/repo-guidance/<repo path>.md`
 * under a key over the files guidance usually lives in, so a later workspace of
 * the repository copies it instead of rediscovering. `docs/` and nested
 * CLAUDE.md files are left out of the key: they move with ordinary feature work,
 * and a pointer that went stale costs a reader one missing file. Delete the
 * cache file to have the next workspace rediscover.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { cloneCacheFile, writeCacheFile } from "./clone-cache";
import { runGit, type GitExec } from "./git-exec";

export interface RepoGuidanceCacheEntry {
  file: string;
  key: string;
}

export interface RepoGuidance {
  implementation: string;
  review: string;
}

/** Bump when the fingerprint rules change, so entries keyed by the old rules miss. */
const FINGERPRINT_VERSION = "v1";

const KEYED_PATHS = [
  ".claude",
  ".agents",
  "CLAUDE.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  ".github",
  ".reviewdog.yml",
];

const KEY_LINE = /^<!-- aiw-repo-guidance key=([0-9a-f]+) -->\n/;
const NOTE_LINE = /^<!-- .* -->\n\n?/;

export function repoGuidancePath(wsPath: string, repoName: string): string {
  return path.join(wsPath, "artifacts", "repo-guidance", `${repoName}.md`);
}

/**
 * Bullets only, with their indented continuation lines: what an agent writes
 * under a heading when it found nothing ("None found.") is not guidance.
 */
function sectionBullets(content: string, heading: string): string {
  const match = content.match(new RegExp(`^## ${heading}[ \\t]*$`, "m"));
  if (!match) return "";
  const body = content.slice(match.index! + match[0].length).split(/\n(?=#{1,2} )/)[0];

  const kept: string[] = [];
  let inBullet = false;
  for (const line of body.split("\n")) {
    if (/^[-*] /.test(line)) inBullet = true;
    else if (!/^\s+\S/.test(line)) inBullet = false;
    if (inBullet) kept.push(line);
  }
  return kept.join("\n").trim();
}

export function parseRepoGuidance(content: string): RepoGuidance {
  return {
    implementation: sectionBullets(content, "Implementation"),
    review: sectionBullets(content, "Review"),
  };
}

/** The workspace's guidance for a repository, or `null` when discovery wrote none. */
export async function readRepoGuidance(wsPath: string, repoName: string): Promise<RepoGuidance | null> {
  try {
    return parseRepoGuidance(await readFile(repoGuidancePath(wsPath, repoName), "utf8"));
  } catch {
    return null;
  }
}

async function fingerprint(worktreePath: string, git: GitExec): Promise<string | null> {
  const tree = await git(["ls-tree", "HEAD", "--", ...KEYED_PATHS], worktreePath);
  if (!tree.ok) return null;
  return createHash("sha256").update(`${FINGERPRINT_VERSION}\n${tree.out}`).digest("hex");
}

/**
 * Where a worktree's clone keeps its guidance, and the key its current checkout
 * computes. `null` when the worktree is not a worktree of a clone under
 * `repositories/`, or its HEAD cannot be read.
 */
export async function locateRepoGuidanceCache(
  worktreePath: string,
  git: GitExec = runGit,
): Promise<RepoGuidanceCacheEntry | null> {
  const file = await cloneCacheFile(worktreePath, "repo-guidance", git);
  if (!file) return null;

  const key = await fingerprint(worktreePath, git);
  if (!key) return null;
  return { file, key };
}

/** The cached guidance text when the entry's key still matches, else `null`. */
export async function readRepoGuidanceCache(entry: RepoGuidanceCacheEntry): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(entry.file, "utf8");
  } catch {
    return null;
  }
  const key = content.match(KEY_LINE);
  if (key?.[1] !== entry.key) return null;
  return content.slice(key[0].length).replace(NOTE_LINE, "");
}

export async function writeRepoGuidanceCache(entry: RepoGuidanceCacheEntry, guidance: string): Promise<void> {
  const content = [
    `<!-- aiw-repo-guidance key=${entry.key} -->`,
    "<!-- Copied into every new workspace of this repository while the key matches its .claude/, CLAUDE.md, AGENTS.md, CONTRIBUTING.md and .github/. Edit to correct it; delete this file to have the next workspace rediscover. -->",
    "",
    guidance,
  ].join("\n");
  await writeCacheFile(entry.file, content);
}
