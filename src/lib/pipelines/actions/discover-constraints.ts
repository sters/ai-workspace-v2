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
type Pending = { repo: Repo; entry: RepoConstraintsCacheEntry | null };
type CheckoutGroup = { leader: Pending; followers: Repo[] };

/**
 * Write the cached repositories' blocks into the README and return the ones
 * that still need discovery. A README that cannot be read or written leaves
 * every repository to discovery.
 */
async function applyCachedConstraints(
  ctx: PhaseFunctionContext,
  wsPath: string,
  repos: Repo[],
): Promise<Pending[]> {
  const located = await Promise.all(repos.map(async (repo) => {
    const entry = await locateRepoConstraintsCache(repo.worktreePath);
    return { repo, entry, cached: entry ? await readRepoConstraintsCache(entry) : null };
  }));
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
 * Split pending repositories into one discovery per checkout and the
 * repositories that take its result. Worktrees of one clone whose build files
 * compute the same key would discover the same commands, so only the first
 * runs. A repository without a cache entry is always discovered on its own.
 */
function groupByCheckout(pending: Pending[]): CheckoutGroup[] {
  const groups: CheckoutGroup[] = [];
  const byKey = new Map<string, CheckoutGroup>();
  for (const p of pending) {
    const id = p.entry ? `${p.entry.file}\0${p.entry.key}` : null;
    const existing = id ? byKey.get(id) : undefined;
    if (existing) {
      existing.followers.push(p.repo);
      continue;
    }
    const group: CheckoutGroup = { leader: p, followers: [] };
    groups.push(group);
    if (id) byKey.set(id, group);
  }
  return groups;
}

/**
 * Cache what each successful child appended, under the key computed before it
 * ran, and declare the same block for the repositories that shared its
 * discovery. Returns whether every follower of a successful child was declared.
 */
async function settleDiscovered(
  ctx: PhaseFunctionContext,
  wsPath: string,
  groups: CheckoutGroup[],
  results: boolean[],
): Promise<boolean> {
  const succeeded = groups.filter((_, i) => results[i]);
  if (!succeeded.some((g) => g.leader.entry || g.followers.length > 0)) return true;
  let followersDeclared = !succeeded.some((g) => g.followers.length > 0);
  try {
    let { content } = await readWorkspaceReadme(wsPath);
    const declared = parseConstraints(content);
    const blocks = succeeded.flatMap(({ leader, followers }) => {
      const block = declared.find((c) => c.repoName === leader.repo.repoName);
      return block ? [{ leader, followers, constraints: block.constraints }] : [];
    });
    if (blocks.some((b) => b.followers.length > 0)) {
      for (const { followers, constraints } of blocks) {
        for (const follower of followers) content = appendRepoConstraints(content, follower.repoName, constraints);
      }
      await Bun.write(path.join(wsPath, "README.md"), content);
    }
    followersDeclared = true;
    for (const { leader, constraints } of blocks) {
      if (leader.entry) await writeRepoConstraintsCache(leader.entry, constraints);
    }
    return true;
  } catch (err) {
    ctx.emitStatus(`Could not record discovered constraints: ${err}`);
    return followersDeclared;
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

      const systemPromptFile = await ensureSystemPrompt(input.wsPath, "repo-constraints");
      const groups = groupByCheckout(pending);
      const children = groups.map(({ leader: { repo } }) => ({
        label: `constraints-${repo.repoName}`,
        stepType: STEP_TYPES.DISCOVER_CONSTRAINTS,
        prompt: buildRepoConstraintsPrompt({
          workspaceName: input.workspace,
          repoName: repo.repoName,
          worktreePath: repo.worktreePath,
          readmePath,
        }),
        addDirs: [input.wsPath],
        appendSystemPromptFile: systemPromptFile,
      }));

      for (const { leader, followers } of groups) {
        if (followers.length === 0) continue;
        ctx.emitStatus(
          `Sharing ${leader.repo.repoName}'s discovery with ${followers.map((f) => f.repoName).join(", ")} (same checkout of one clone)`,
        );
      }
      ctx.emitStatus(`Discovering constraints for ${children.length} repositories`);
      const results = await ctx.runChildGroup(children);
      const shared = await settleDiscovered(ctx, input.wsPath, groups, results);
      const succeeded = results.filter(Boolean).length;
      ctx.emitStatus(`Constraint discovery complete: ${succeeded}/${results.length} succeeded`);
      if (!shared) return false;
      return results.every(Boolean);
    },
  };
}
