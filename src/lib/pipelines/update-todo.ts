import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildUpdaterPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { runBestOfNFiles } from "./actions/best-of-n-files";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

export async function buildUpdateTodoPipeline(input: {
  workspace: string;
  instruction: string;
  repo?: string;
  bestOfN?: number;
  bestOfNConfirm?: boolean;
  interactionLevel?: InteractionLevel;
}): Promise<PipelinePhase[]> {
  const { workspace, instruction, repo, bestOfN, bestOfNConfirm, interactionLevel } = input;
  const workspacePath = path.join(getWorkspaceDir(), workspace);

  const readmeFile = Bun.file(path.join(workspacePath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const allRepos = listWorkspaceRepos(workspace);
  const repos = repo
    ? allRepos.filter((r) => r.repoName === repo)
    : allRepos;

  // Read TODO content once (shared across all candidates)
  const todoContents = await Promise.all(repos.map(async (r) => {
    const todoFile = Bun.file(path.join(workspacePath, `TODO-${r.repoName}.md`));
    return (await todoFile.exists()) ? await todoFile.text() : "";
  }));

  /** Build the combined updater prompt pointing at a given workspace directory. */
  const buildPromptForDir = (wsDir: string) => {
    const prompts = repos.map((r, i) =>
      buildUpdaterPrompt({
        workspaceName: workspace,
        repoName: r.repoName,
        readmeContent,
        todoContent: todoContents[i],
        worktreePath: r.worktreePath,
        workspacePath: wsDir,
        instruction,
      }),
    );
    return prompts.length === 1
      ? prompts[0]
      : prompts.map((p, i) => `# Repo ${i + 1} of ${prompts.length}\n\n${p}`).join("\n\n---\n\n");
  };

  const prompt = buildPromptForDir(workspacePath);

  if (bestOfN && bestOfN >= 2) {
    const todoFiles = repos.map((r) => path.join(workspacePath, `TODO-${r.repoName}.md`));

    return [{
      kind: "function",
      label: "Update TODOs (Best-of-N)",
      timeoutMs: 60 * 60 * 1000,
      fn: async (ctx) => {
        return runBestOfNFiles({
          ctx,
          n: bestOfN,
          operationType: "update-todo",
          filesToCapture: todoFiles,
          buildChildren: (candidateDir) => [{
            label: "Update TODOs",
            prompt: buildPromptForDir(candidateDir),
            stepType: STEP_TYPES.UPDATE_TODO,
            addDirs: [candidateDir, ...repos.map((r) => r.worktreePath)],
            appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater"),
          }],
          confirm: bestOfNConfirm,
          interactionLevel,
          runNormal: async (innerCtx) => {
            return innerCtx.runChild("Update TODOs", prompt, { addDirs: [workspacePath], stepType: STEP_TYPES.UPDATE_TODO, appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater") });
          },
        });
      },
    }];
  }

  return [
    { kind: "single", label: "Update TODOs", prompt, stepType: STEP_TYPES.UPDATE_TODO, addDirs: [workspacePath], appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater") },
  ];
}
