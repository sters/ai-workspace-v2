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
import { getWorkspaceDir } from "@/lib/config";
import { buildPRCreatorPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";

/**
 * The README's `# Task:` heading, when it is a real title. Handing the same
 * string to every repo's child is what stops sibling PRs of one task carrying
 * unrelated titles — the children run in parallel and each sees only its own
 * diff, so nothing else can align them.
 *
 * Placeholders are rejected rather than mandated: a README that `init-readme`
 * never rewrote (hand-edited, or `init --only`) still carries the template's
 * `TBD`, and `parseReadmeMeta` reports a missing heading as `Untitled`.
 */
function resolveSharedTitle(title: string): string | null {
  const trimmed = title.trim().replace(/^Task:\s*/i, "").trim();
  if (!trimmed || /^(TBD|Untitled)$/i.test(trimmed)) return null;
  return trimmed;
}

export async function buildCreatePrPipeline(input: {
  workspace: string;
  draft: boolean;
  repository?: string;
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
}): Promise<PipelinePhase[]> {
  const { workspace, draft, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = input.repos ?? listWorkspaceRepos(workspace);
  const repos = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;

  const wsPath = path.join(getWorkspaceDir(), workspace);
  const sharedTitle = resolveSharedTitle(meta.title);

  const children = await Promise.all(repos.map(async (repo) => {
    // Detect base branch from README metadata or repo itself
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);

    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch);
    const existingPR = checkExistingPR(repo.worktreePath);
    const prTemplate = readPRTemplate(repo.worktreePath);

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
      ...(!existingPR.exists && sharedTitle && { sharedTitle }),
      ...(prReviewThreads && { prReviewThreads, todoFilePath }),
    });

    return {
      label: repo.repoName,
      prompt,
      stepType: STEP_TYPES.CREATE_PR,
      addDirs: [wsPath],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "pr-creator"),
    };
  }));

  return [
    { kind: "group", children },
  ];
}
