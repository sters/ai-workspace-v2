/**
 * Archiving a workspace, shared by the UI route and the MCP tool.
 *
 * An archived workspace is no longer watched, so a PR left open would sit
 * there unattended. Archiving with open PRs therefore requires the caller to
 * ask for them to be closed; they are closed, their branches deleted, and the
 * close recorded as aiw's own so lesson distillation does not read it as a
 * reviewer turning the work down. Lessons are then harvested from the result.
 */

import { archiveWorkspace } from "@/lib/db/archives";
import { getPrSnapshot, savePrObservation } from "@/lib/db/pr-watch";
import { startOperationPipeline } from "@/lib/pipeline";
import { buildHarvestLessonsPipeline } from "@/lib/pipelines/harvest-lessons";
import { observePr } from "@/lib/pr-watcher/observe";
import { execArgs } from "./helpers";
import { listWorkspacePullRequests } from "./pr-threads";
import { runGit } from "./git-exec";
import type { WorkspacePullRequest } from "@/types/pull-request";

export interface OpenPullRequest {
  repoName: string;
  url: string;
  title: string;
}

export class OpenPullRequestsError extends Error {
  constructor(readonly pullRequests: OpenPullRequest[]) {
    super(`Workspace has ${pullRequests.length} open pull request(s); pass closeOpenPrs to close them and archive.`);
  }
}

export interface ArchiveDeps {
  listPullRequests: (workspace: string) => Promise<WorkspacePullRequest[]>;
  closePullRequest: (pr: WorkspacePullRequest) => Promise<void>;
  deleteBranch: (pr: WorkspacePullRequest) => Promise<void>;
  startHarvest: (workspace: string) => string;
}

const defaultDeps: ArchiveDeps = {
  listPullRequests: async (workspace) => (await listWorkspacePullRequests(workspace)).pullRequests,
  closePullRequest: async (pr) => {
    await execArgs(["gh", "pr", "close", pr.url], { cwd: pr.worktreePath });
  },
  deleteBranch: async (pr) => {
    const res = await runGit(["push", "origin", "--delete", pr.headRefName], pr.worktreePath);
    if (!res.ok) throw new Error(res.out);
  },
  startHarvest: (workspace) =>
    startOperationPipeline("harvest-lessons", workspace, buildHarvestLessonsPipeline(workspace)).id,
};

export interface ArchiveResult {
  closed: string[];
  warnings: string[];
  /** The harvest operation's id, or why none started. */
  harvest: { operationId: string } | { error: string };
}

function recordClosedByArchive(workspace: string, pr: WorkspacePullRequest): void {
  const now = new Date().toISOString();
  const { snapshot, events } = observePr(getPrSnapshot(workspace, pr.repoName), pr, workspace, now);
  savePrObservation({ ...snapshot, state: "CLOSED" }, [
    ...events,
    { workspace, repoName: pr.repoName, prUrl: pr.url, kind: "closed-by-archive", author: null, body: "Closed by aiw when the workspace was archived", url: pr.url, occurredAt: now },
  ]);
}

export async function archiveWorkspaceWithPrs(
  workspace: string,
  opts: { closeOpenPrs?: boolean },
  deps: ArchiveDeps = defaultDeps,
): Promise<ArchiveResult> {
  const open = (await deps.listPullRequests(workspace)).filter((pr) => pr.state === "OPEN");
  if (open.length > 0 && !opts.closeOpenPrs) {
    throw new OpenPullRequestsError(open.map((pr) => ({ repoName: pr.repoName, url: pr.url, title: pr.title })));
  }

  const closed: string[] = [];
  const warnings: string[] = [];
  for (const pr of open) {
    // A close that fails leaves the workspace unarchived, so the PR stays watched.
    await deps.closePullRequest(pr);
    recordClosedByArchive(workspace, pr);
    closed.push(pr.url);
    try {
      await deps.deleteBranch(pr);
    } catch (err) {
      warnings.push(`${pr.repoName}: could not delete branch ${pr.headRefName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  archiveWorkspace(workspace);

  let harvest: ArchiveResult["harvest"];
  try {
    harvest = { operationId: deps.startHarvest(workspace) };
  } catch (err) {
    harvest = { error: err instanceof Error ? err.message : String(err) };
  }
  return { closed, warnings, harvest };
}
