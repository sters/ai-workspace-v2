/**
 * What the lesson distiller reads for one repository of one workspace: the PR
 * and how people reacted to it, the commits people added after aiw, and aiw's
 * own review findings — this workspace's, and earlier workspaces' of the same
 * clone so recurrence is visible.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listOperations } from "@/lib/db/operations";
import { listPrEvents } from "@/lib/db/pr-watch";
import { listPriorLessonFindings, type LessonFinding } from "@/lib/db/repo-lessons";
import { pathExists } from "@/lib/fs";
import { execArgs } from "@/lib/workspace/helpers";
import { parseKnownFindings, readKnownFindings } from "@/lib/workspace/known-findings";
import { readRepoPullRequest } from "@/lib/workspace/pr-threads";
import { readRepoFindings } from "@/lib/workspace/review-findings";
import { runGit } from "@/lib/workspace/git-exec";
import { readdir } from "node:fs/promises";
import type { PrEvent } from "@/types/pr-watch";
import type { WorkspacePullRequest } from "@/types/pull-request";
import type { WorkspaceRepo } from "@/types/workspace";

const MAX_HUMAN_COMMITS = 10;
const MAX_PATCH_CHARS = 6000;
const MAX_PRIOR_FINDINGS = 200;

export interface HumanCommit {
  sha: string;
  subject: string;
  committedAt: string;
  patch: string;
}

export interface LessonMaterial {
  repoKey: string;
  repoName: string;
  pr: WorkspacePullRequest | null;
  /** True when aiw itself closed the PR on archive, which says nothing about the work. */
  closedByArchive: boolean;
  events: PrEvent[];
  humanCommits: HumanCommit[];
  findings: { summary: string; kind: string }[];
  priorFindings: LessonFinding[];
}

export interface PrCommit {
  oid: string;
  committedDate: string;
  messageHeadline: string;
}

/**
 * aiw and people commit under the same git identity, so a commit is told apart
 * by when it was made: one committed while no operation ran on the workspace
 * was made by a person. A rebase aiw runs re-dates the commits it rewrites, so
 * they land inside its window.
 */
export function selectHumanCommits(
  commits: PrCommit[],
  windows: { startedAt: string; completedAt?: string }[],
  now: string,
): PrCommit[] {
  const spans = windows.map((w) => [Date.parse(w.startedAt), Date.parse(w.completedAt ?? now)] as const);
  return commits.filter((c) => {
    const t = Date.parse(c.committedDate);
    return Number.isFinite(t) && !spans.some(([s, e]) => t >= s && t <= e);
  });
}

async function readHumanCommits(workspace: string, pr: WorkspacePullRequest): Promise<HumanCommit[]> {
  let commits: PrCommit[];
  try {
    const raw = await execArgs(["gh", "pr", "view", pr.url, "--json", "commits"], { cwd: pr.worktreePath });
    commits = (JSON.parse(raw) as { commits?: PrCommit[] }).commits ?? [];
  } catch {
    return [];
  }
  const human = selectHumanCommits(commits, listOperations(workspace), new Date().toISOString()).slice(-MAX_HUMAN_COMMITS);
  if (human.length === 0) return [];

  // The PR's head ref outlives the branch, so this works after the branch is deleted.
  await runGit(["fetch", "--quiet", "origin", `pull/${pr.number}/head`], pr.worktreePath);
  const out: HumanCommit[] = [];
  for (const c of human) {
    const show = await runGit(["show", "--format=", "--patch", "--stat", c.oid], pr.worktreePath);
    out.push({
      sha: c.oid,
      subject: c.messageHeadline,
      committedAt: c.committedDate,
      patch: show.ok ? show.out.slice(0, MAX_PATCH_CHARS) : "(patch unavailable)",
    });
  }
  return out;
}

async function readWorkspaceFindings(workspace: string, repo: WorkspaceRepo): Promise<{ summary: string; kind: string }[]> {
  const wsPath = path.join(getWorkspaceDir(), workspace);
  const reviewsDir = path.join(wsPath, "artifacts", "reviews");
  const findings = new Map<string, string>();
  if (await pathExists(reviewsDir)) {
    for (const ts of (await readdir(reviewsDir)).sort()) {
      for (const f of await readRepoFindings(path.join(reviewsDir, ts), repo.repoPath, repo.repoName)) {
        findings.set(f.title, `review:${f.severity}`);
      }
    }
  }
  for (const f of parseKnownFindings(await readKnownFindings(wsPath))) {
    findings.set(f.summary, `known:${f.kind}`);
  }
  return [...findings].map(([summary, kind]) => ({ summary, kind }));
}

export async function gatherLessonMaterial(
  workspace: string,
  repo: WorkspaceRepo,
  repoKey: string,
): Promise<LessonMaterial> {
  const read = await readRepoPullRequest(repo);
  const pr = read.pr ?? null;
  const events = pr ? listPrEvents(workspace).filter((e) => e.prUrl === pr.url) : [];
  return {
    repoKey,
    repoName: repo.repoName,
    pr,
    closedByArchive: events.some((e) => e.kind === "closed-by-archive"),
    events,
    humanCommits: pr ? await readHumanCommits(workspace, pr) : [],
    findings: await readWorkspaceFindings(workspace, repo),
    priorFindings: listPriorLessonFindings(repoKey, workspace, MAX_PRIOR_FINDINGS),
  };
}

/** Whether anything here could support a lesson; a repository with nothing is not worth a model call. */
export function hasLessonSignal(m: LessonMaterial): boolean {
  const reviewed = m.pr?.threads.some((t) => t.comments.length > 0) ?? false;
  const rejected = m.pr?.state === "CLOSED" && !m.closedByArchive;
  return reviewed || rejected || m.humanCommits.length > 0 || m.findings.length > 0;
}
