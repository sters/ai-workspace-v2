import path from "node:path";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  checkExistingPR,
  readPRTemplate,
} from "@/lib/workspace";
import { WORKSPACE_DIR } from "@/lib/config";
import { buildPRCreatorPrompt } from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";

export async function buildCreatePrPipeline(input: {
  workspace: string;
  draft: boolean;
  repository?: string;
}): Promise<PipelinePhase[]> {
  const { workspace, draft, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = listWorkspaceRepos(workspace);
  const repos = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;

  const children = repos.map((repo) => {
    // Detect base branch from README metadata or repo itself
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);

    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch);
    const existingPR = checkExistingPR(repo.worktreePath);
    const prTemplate = readPRTemplate(repo.worktreePath);

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
    });

    return {
      label: repo.repoName,
      prompt,
      addDirs: [path.join(WORKSPACE_DIR, workspace)],
    };
  });

  return [
    { kind: "group", children },
  ];
}
