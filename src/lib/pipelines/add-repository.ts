import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { pathExists } from "@/lib/fs";
import { normalizeRepoPath } from "@/lib/parsers/readme";
import { commitWorkspaceSnapshot, listWorkspaceRepos } from "@/lib/workspace/git";
import { declareRepository } from "@/lib/workspace/quick-create";
import { setupRepository } from "./actions/setup-repository";
import { discoverConstraintsForNewRepos } from "./actions/ensure-repositories";
import type { PipelinePhase } from "@/types/pipeline";

/**
 * Add a worktree to an existing workspace and declare it in the README.
 * `repository` may carry `:alias` for another worktree of a repository the
 * workspace already has; `branch` checks out an existing remote branch instead
 * of cutting a new one from the base.
 */
export function buildAddRepositoryPipeline(input: {
  workspace: string;
  repository: string;
  baseBranch?: string;
  branch?: string;
}): PipelinePhase[] {
  const { workspace, repository, baseBranch, branch } = input;
  return [
    {
      kind: "function",
      label: "Add repository",
      // A clone plus the constraint and guidance discovery children.
      timeoutMs: 20 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        // setupRepository replaces an existing worktree directory, uncommitted work included.
        const target = normalizeRepoPath(repository);
        if ((await listWorkspaceRepos(workspace)).some((r) => r.repoPath === target)) {
          ctx.emitResult(
            `${repository} already has a worktree in this workspace. For another one, give it an alias: \`${repository.split(":")[0]}:<alias>\`.`,
          );
          return false;
        }

        const result = await setupRepository(workspace, repository, baseBranch, ctx.emitStatus, branch);
        const readmePath = path.join(getWorkspaceDir(), workspace, "README.md");
        if (await pathExists(readmePath)) {
          await Bun.write(readmePath, declareRepository(await Bun.file(readmePath).text(), result));
        }
        ctx.emitResult(
          `Added ${result.repoPath} at ${result.worktreePath} on branch ${result.branchName} (base: ${result.baseBranch}).`,
        );

        if (!(await discoverConstraintsForNewRepos(ctx, workspace, [result]))) {
          ctx.emitResult(
            "Constraint discovery did not complete — check `## Repository Constraints` in README.md.",
          );
        }
        await commitWorkspaceSnapshot(workspace, `Add repository ${result.repoPath}`);
        return true;
      },
    },
  ];
}
