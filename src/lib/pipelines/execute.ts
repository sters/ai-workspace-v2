import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { listWorkspaceRepos, writeReportTemplates } from "@/lib/workspace";
import { buildExecutorPrompt, buildResearcherPrompt } from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";

export async function buildExecutePipeline(input: {
  workspace: string;
}): Promise<PipelinePhase[]> {
  const { workspace } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const repos = listWorkspaceRepos(workspace);
  const wsPath = path.join(WORKSPACE_DIR, workspace);

  const isResearch = meta.taskType === "research";

  if (isResearch) {
    // Write report templates (idempotent — ensures templates exist for older workspaces)
    await writeReportTemplates(wsPath);

    const reportPath = path.join(wsPath, "artifacts", "research-report.md");
    const prompt = buildResearcherPrompt({
      workspaceName: workspace,
      readmeContent,
      repos: repos.map((r) => ({
        repoPath: r.repoPath,
        repoName: r.repoName,
        worktreePath: r.worktreePath,
      })),
      workspacePath: wsPath,
      reportPath,
    });

    return [
      { kind: "single", label: "Research", prompt },
    ];
  }

  // Feature/bugfix: launch one executor per repository
  const children = await Promise.all(repos.map(async (repo) => {
    const todoFileName = `TODO-${repo.repoName}.md`;
    const todoFile = Bun.file(path.join(wsPath, todoFileName));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    const prompt = buildExecutorPrompt({
      workspaceName: workspace,
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      readmeContent,
      todoContent,
      worktreePath: repo.worktreePath,
    });

    return {
      label: repo.repoName,
      prompt,
    };
  }));

  return [
    { kind: "group", children },
  ];
}
