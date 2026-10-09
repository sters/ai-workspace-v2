import path from "node:path";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { extractPrReviewThreadsSection } from "@/lib/parsers/todo";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  checkExistingPR,
  readPRTemplate,
} from "@/lib/workspace";
import {
  getSoleCommitSubject,
  resolvePrTitle,
  resolveTaskTitle,
} from "@/lib/workspace/pr-title";
import { getWorkspaceDir } from "@/lib/config";
import { buildPRCreatorPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { selectRepos } from "@/lib/workspace/select-repos";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";

export async function buildCreatePrPipeline(input: {
  workspace: string;
  draft: boolean;
  repository?: string;
  /** Narrows `repository`'s selection further to these worktrees — the ones an autonomous run finished when it stops with others still open. */
  repositories?: readonly string[];
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
}): Promise<PipelinePhase[]> {
  const { workspace, draft, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = input.repos ?? await listWorkspaceRepos(workspace);
  const repos = selectRepos(allRepos, { repository, repositories: input.repositories });

  const wsPath = path.join(getWorkspaceDir(), workspace);
  const taskTitle = resolveTaskTitle(meta.title);
  // Read from every worktree, not the selection: a run narrowed to one worktree
  // still opens its PR next to the siblings' PRs.
  const cloneOf = (repo: WorkspaceRepo) => repo.repoPath.split("___")[0];
  const sameRepoSiblings = (repo: WorkspaceRepo) => {
    const names = allRepos
      .filter((r) => r !== repo && cloneOf(r) === cloneOf(repo))
      .map((r) => r.repoName);
    return names.length > 0 ? names : undefined;
  };

  const children = await Promise.all(repos.map(async (repo) => {
    // Detect base branch from README metadata or repo itself
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? (await detectBaseBranch(repo.worktreePath));

    const [changes, existingPR] = await Promise.all([
      getRepoChanges(workspace, repo.repoPath, baseBranch),
      checkExistingPR(repo.worktreePath),
    ]);
    const prTemplate = await readPRTemplate(repo.worktreePath);

    // Per-repo, and only reached without a task title: a sole commit's subject
    // describes that repo's whole change, but it cannot align the siblings.
    const title = resolvePrTitle({
      taskTitle,
      ticketId: meta.ticketId,
      soleCommitSubject: taskTitle
        ? null
        : await getSoleCommitSubject(repo.worktreePath, baseBranch),
    });

    // Review threads an earlier PR-review triage turned into TODO items. This is
    // the phase that pushes, so it is the first point at which a reply can name a
    // commit that exists on the remote.
    const todoFilePath = path.join(wsPath, `TODO-${repo.repoName}.md`);
    const todoFile = Bun.file(todoFilePath);
    const prReviewThreads = (await todoFile.exists())
      ? extractPrReviewThreadsSection(await todoFile.text())
      : null;

    const prompt = buildPRCreatorPrompt({
      workspaceName: workspace,
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      baseBranch,
      worktreePath: repo.worktreePath,
      readmeContent,
      repoChanges: `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`,
      draft,
      prTemplate: prTemplate ?? undefined,
      existingPR: existingPR.exists
        ? { url: existingPR.url!, title: existingPR.title!, body: existingPR.body! }
        : undefined,
      // Only a new PR gets the mandated title: the update path retitles only when
      // scope shifted, and the existing title may be the user's own wording.
      ...(!existingPR.exists && title && { sharedTitle: title }),
      ...(!existingPR.exists && { sameRepoSiblings: sameRepoSiblings(repo) }),
      ...(prReviewThreads && { prReviewThreads, todoFilePath }),
    });

    return {
      label: repo.repoName,
      prompt,
      stepType: STEP_TYPES.CREATE_PR,
      addDirs: [wsPath],
      appendSystemPromptFile: await ensureSystemPrompt(wsPath, "pr-creator"),
    };
  }));

  return [
    { kind: "group", children },
  ];
}
