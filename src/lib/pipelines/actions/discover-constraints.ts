import path from "node:path";
import { buildRepoConstraintsPrompt } from "@/lib/templates";
import { readWorkspaceReadme, parseConstraints } from "@/lib/parsers/readme";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhaseFunction } from "@/types/pipeline";

/**
 * Repository names the README already declares commands for. Discovery appends
 * to that section, so re-running it for a declared repo writes a second
 * `### <repo>` block and the constraint runner executes the set twice.
 * A README that cannot be read declares nothing — discovery then proceeds,
 * which is the init case.
 */
async function alreadyDeclared(wsPath: string): Promise<Set<string>> {
  try {
    const { content } = await readWorkspaceReadme(wsPath);
    return new Set(parseConstraints(content).map((c) => c.repoName));
  } catch {
    return new Set();
  }
}

export function buildDiscoverConstraintsPhase(input: {
  workspace: string;
  wsPath: string;
  repos: { repoName: string; worktreePath: string }[];
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Discover repo constraints",
    fn: async (ctx) => {
      if (input.repos.length === 0) {
        ctx.emitResult("No repositories configured — skipping constraint discovery.");
        return true;
      }

      const declared = await alreadyDeclared(input.wsPath);
      const repos = input.repos.filter((r) => !declared.has(r.repoName));
      if (repos.length === 0) {
        ctx.emitStatus("Constraints already declared for every repository");
        return true;
      }
      if (repos.length < input.repos.length) {
        const skipped = input.repos
          .filter((r) => declared.has(r.repoName))
          .map((r) => r.repoName);
        ctx.emitStatus(`Constraints already declared for ${skipped.join(", ")}`);
      }

      const readmePath = path.join(input.wsPath, "README.md");

      const children = repos.map((repo) => ({
        label: `constraints-${repo.repoName}`,
        stepType: STEP_TYPES.DISCOVER_CONSTRAINTS,
        prompt: buildRepoConstraintsPrompt({
          workspaceName: input.workspace,
          repoName: repo.repoName,
          worktreePath: repo.worktreePath,
          readmePath,
        }),
        addDirs: [input.wsPath],
        appendSystemPromptFile: ensureSystemPrompt(input.wsPath, "repo-constraints"),
      }));

      ctx.emitStatus(`Discovering constraints for ${children.length} repositories`);
      const results = await ctx.runChildGroup(children);
      const succeeded = results.filter(Boolean).length;
      ctx.emitStatus(`Constraint discovery complete: ${succeeded}/${results.length} succeeded`);
      return results.every(Boolean);
    },
  };
}
