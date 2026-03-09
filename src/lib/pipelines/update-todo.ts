import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildUpdaterPrompt } from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";

export async function buildUpdateTodoPipeline(input: {
  workspace: string;
  instruction: string;
}): Promise<PipelinePhase[]> {
  const { workspace, instruction } = input;
  const workspacePath = path.join(WORKSPACE_DIR, workspace);

  const readmeFile = Bun.file(path.join(workspacePath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const repos = listWorkspaceRepos(workspace);

  const prompts = await Promise.all(repos.map(async (repo) => {
    const todoFile = Bun.file(path.join(workspacePath, `TODO-${repo.repoName}.md`));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    return buildUpdaterPrompt({
      workspaceName: workspace,
      repoName: repo.repoName,
      readmeContent,
      todoContent,
      worktreePath: repo.worktreePath,
      workspacePath,
      instruction,
    });
  }));

  const prompt =
    prompts.length === 1
      ? prompts[0]
      : prompts
          .map((p, i) => `# Repo ${i + 1} of ${prompts.length}\n\n${p}`)
          .join("\n\n---\n\n");

  return [
    { kind: "single", label: "Update TODOs", prompt, addDirs: [workspacePath] },
  ];
}
