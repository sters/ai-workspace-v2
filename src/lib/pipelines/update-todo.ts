import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getCleanEnv } from "@/lib/env";
import { listWorkspaceRepos } from "@/lib/workspace";
import { selectRepos } from "@/lib/workspace/select-repos";
import { normalizeTodoCheckboxes } from "@/lib/parsers/todo";
import { buildUpdaterPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";

export async function buildUpdateTodoPipeline(input: {
  workspace: string;
  instruction: string;
  repo?: string;
  /** Narrows `repo`'s selection further to these worktrees — an autonomous cycle's unfinished set. */
  repositories?: readonly string[];
  interject?: boolean;
}): Promise<PipelinePhase[]> {
  const { workspace, instruction, repo, repositories, interject } = input;
  const workspacePath = path.join(getWorkspaceDir(), workspace);

  const readmeFile = Bun.file(path.join(workspacePath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const repos = selectRepos(await listWorkspaceRepos(workspace), { repository: repo, repositories });

  const todoContents = await Promise.all(repos.map(async (r) => {
    const todoFile = Bun.file(path.join(workspacePath, `TODO-${r.repoName}.md`));
    return (await todoFile.exists()) ? await todoFile.text() : "";
  }));

  const prompts = repos.map((r, i) =>
    buildUpdaterPrompt({
      workspaceName: workspace,
      repoName: r.repoName,
      readmeContent,
      todoContent: todoContents[i],
      worktreePath: r.worktreePath,
      workspacePath,
      instruction,
      ...(interject && { interject: true }),
    }),
  );
  const prompt = prompts.length === 1
    ? prompts[0]
    : prompts.map((p, i) => `# Repo ${i + 1} of ${prompts.length}\n\n${p}`).join("\n\n---\n\n");

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

  return [
    { kind: "single", label: "Update TODOs", prompt, stepType: STEP_TYPES.UPDATE_TODO, addDirs: [workspacePath], allowedTools: todoAllowedTools, appendSystemPromptFile: await ensureSystemPrompt(workspacePath, "updater") },
    normalizePhase,
  ];
}
