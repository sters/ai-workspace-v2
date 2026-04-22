import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getCleanEnv } from "@/lib/env";
import { listWorkspaceRepos } from "@/lib/workspace";
import { normalizeTodoCheckboxes } from "@/lib/parsers/todo";
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

  // Restrict Edit/Write to TODO files only — prevent the updater agent from
  // modifying source code even though it has read access to the full workspace.
  const absPrefix = workspacePath.startsWith("/") ? "/" : "//";
  const todoAllowedTools = [
    `Edit(${absPrefix}${workspacePath}/TODO-*.md)`,
    `Write(${absPrefix}${workspacePath}/TODO-*.md)`,
    "Bash(git:*)",
  ];

  // Phase that normalizes checkbox format after the updater runs.
  // Fixes common LLM mistakes (missing checkboxes, wrong brackets, etc.)
  // and amends the updater's commit if any corrections were made.
  const normalizePhase: PipelinePhase = {
    kind: "function",
    label: "Normalize TODO format",
    timeoutMs: 30_000,
    fn: async (ctx) => {
      const modified: string[] = [];
      for (const r of repos) {
        const todoPath = path.join(workspacePath, `TODO-${r.repoName}.md`);
        const file = Bun.file(todoPath);
        if (!(await file.exists())) continue;

        const content = await file.text();
        const normalized = normalizeTodoCheckboxes(content);
        if (normalized !== content) {
          await Bun.write(todoPath, normalized);
          modified.push(`TODO-${r.repoName}.md`);
        }
      }

      if (modified.length > 0) {
        ctx.emitStatus(`Normalized checkbox format in: ${modified.join(", ")}`);
        // Stage and commit the normalized files
        const env = getCleanEnv();
        const add = Bun.spawn(["git", "add", ...modified], { cwd: workspacePath, env });
        await add.exited;
        const diff = Bun.spawn(["git", "diff", "--cached", "--quiet"], { cwd: workspacePath, env });
        const hasStagedChanges = (await diff.exited) !== 0;
        if (hasStagedChanges) {
          const commit = Bun.spawn(
            ["git", "commit", "-m", "Normalize TODO checkbox format"],
            { cwd: workspacePath, env },
          );
          await commit.exited;
        }
      }

      return true;
    },
  };

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
          buildChildren: (candidateDir) => {
            const candidatePrefix = candidateDir.startsWith("/") ? "/" : "//";
            return [{
              label: "Update TODOs",
              prompt: buildPromptForDir(candidateDir),
              stepType: STEP_TYPES.UPDATE_TODO,
              addDirs: [candidateDir, ...repos.map((r) => r.worktreePath)],
              allowedTools: [
                `Edit(${candidatePrefix}${candidateDir}/TODO-*.md)`,
                `Write(${candidatePrefix}${candidateDir}/TODO-*.md)`,
                "Bash(git:*)",
              ],
              appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater"),
            }];
          },
          confirm: bestOfNConfirm,
          interactionLevel,
          runNormal: async (innerCtx) => {
            return innerCtx.runChild("Update TODOs", prompt, { addDirs: [workspacePath], allowedTools: todoAllowedTools, stepType: STEP_TYPES.UPDATE_TODO, appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater") });
          },
        });
      },
    }, normalizePhase];
  }

  return [
    { kind: "single", label: "Update TODOs", prompt, stepType: STEP_TYPES.UPDATE_TODO, addDirs: [workspacePath], allowedTools: todoAllowedTools, appendSystemPromptFile: ensureSystemPrompt(workspacePath, "updater") },
    normalizePhase,
  ];
}
