import path from "node:path";
import { buildRepoConstraintsPrompt } from "@/lib/templates";
import { readWorkspaceReadme, parseConstraints } from "@/lib/parsers/readme";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import {
  appendRepoConstraints,
  locateRepoConstraintsCache,
  readRepoConstraintsCache,
  writeRepoConstraintsCache,
  type RepoConstraintsCacheEntry,
} from "@/lib/workspace/repo-constraints-cache";
import { STEP_TYPES } from "@/types/pipeline";
import type { PhaseFunctionContext, PipelinePhaseFunction } from "@/types/pipeline";

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

type Repo = { repoName: string; worktreePath: string };

/**
 * Write the cached repositories' blocks into the README and return the ones
 * that still need discovery. A README that cannot be read or written leaves
 * every repository to discovery.
 */
async function applyCachedConstraints(
  ctx: PhaseFunctionContext,
  wsPath: string,
  repos: Repo[],
): Promise<{ repo: Repo; entry: RepoConstraintsCacheEntry | null }[]> {
  const located = repos.map((repo) => {
    const entry = locateRepoConstraintsCache(repo.worktreePath);
    return { repo, entry, cached: entry ? readRepoConstraintsCache(entry) : null };
  });
  const hits = located.filter((l) => l.cached);
  const misses = located.filter((l) => !l.cached).map(({ repo, entry }) => ({ repo, entry }));
  if (hits.length === 0) return misses;

  try {
    let { content } = await readWorkspaceReadme(wsPath);
    for (const hit of hits) content = appendRepoConstraints(content, hit.repo.repoName, hit.cached!);
    await Bun.write(path.join(wsPath, "README.md"), content);
  } catch (err) {
    ctx.emitStatus(`Could not write cached constraints into README.md, discovering instead: ${err}`);
    return located.map(({ repo, entry }) => ({ repo, entry }));
  }
  for (const hit of hits) {
    ctx.emitStatus(`Reused cached constraints for ${hit.repo.repoName} (delete ${hit.entry!.file} to rediscover)`);
  }
  return misses;
}

/**
 * Cache what each successful child appended. The key is the one computed
 * before the child ran, which is the checkout it read.
 */
async function cacheDiscoveredConstraints(
  ctx: PhaseFunctionContext,
  wsPath: string,
  discovered: { repo: Repo; entry: RepoConstraintsCacheEntry | null }[],
  results: boolean[],
): Promise<void> {
  if (!discovered.some((d, i) => d.entry && results[i])) return;
  try {
    const declared = parseConstraints((await readWorkspaceReadme(wsPath)).content);
    discovered.forEach(({ repo, entry }, i) => {
      if (!entry || !results[i]) return;
      const block = declared.find((c) => c.repoName === repo.repoName);
      if (block) writeRepoConstraintsCache(entry, block.constraints);
    });
  } catch (err) {
    ctx.emitStatus(`Could not cache discovered constraints: ${err}`);
  }
}

export function buildDiscoverConstraintsPhase(input: {
  workspace: string;
  wsPath: string;
  repos: Repo[];
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
      const undeclared = input.repos.filter((r) => !declared.has(r.repoName));
      if (undeclared.length === 0) {
        ctx.emitStatus("Constraints already declared for every repository");
        return true;
      }
      if (undeclared.length < input.repos.length) {
        const skipped = input.repos
          .filter((r) => declared.has(r.repoName))
          .map((r) => r.repoName);
        ctx.emitStatus(`Constraints already declared for ${skipped.join(", ")}`);
      }

      const pending = await applyCachedConstraints(ctx, input.wsPath, undeclared);
      if (pending.length === 0) return true;

      const readmePath = path.join(input.wsPath, "README.md");

      const children = pending.map(({ repo }) => ({
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
      await cacheDiscoveredConstraints(ctx, input.wsPath, pending, results);
      const succeeded = results.filter(Boolean).length;
      ctx.emitStatus(`Constraint discovery complete: ${succeeded}/${results.length} succeeded`);
      return results.every(Boolean);
    },
  };
}
