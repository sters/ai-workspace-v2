import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "@/lib/fs";
import { buildRepoGuidancePrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import {
  locateRepoGuidanceCache,
  readRepoGuidanceCache,
  repoGuidancePath,
  writeRepoGuidanceCache,
  type RepoGuidanceCacheEntry,
} from "@/lib/workspace/repo-guidance";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PhaseFunctionContext, PipelinePhaseFunction } from "@/types/pipeline";

type Repo = { repoName: string; worktreePath: string };
type CheckoutGroup = { leader: Repo; entry: RepoGuidanceCacheEntry | null; followers: Repo[] };

async function writeGuidance(wsPath: string, repoName: string, guidance: string): Promise<void> {
  const file = repoGuidancePath(wsPath, repoName);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, guidance);
}

async function readWritten(wsPath: string, repoName: string): Promise<string | null> {
  try {
    return await readFile(repoGuidancePath(wsPath, repoName), "utf8");
  } catch {
    return null;
  }
}

/**
 * Copy cached entries into the workspace and group the rest into one discovery
 * per checkout: worktrees of one clone whose guidance files compute the same key
 * would find the same documents.
 */
async function applyCached(ctx: PhaseFunctionContext, wsPath: string, repos: Repo[]): Promise<CheckoutGroup[]> {
  const groups: CheckoutGroup[] = [];
  const byKey = new Map<string, CheckoutGroup>();
  for (const repo of repos) {
    const entry = await locateRepoGuidanceCache(repo.worktreePath);
    const cached = entry ? await readRepoGuidanceCache(entry) : null;
    if (cached !== null) {
      await writeGuidance(wsPath, repo.repoName, cached);
      ctx.emitStatus(`Reused cached guidance for ${repo.repoName} (delete ${entry!.file} to rediscover)`);
      continue;
    }
    const id = entry ? `${entry.file}\0${entry.key}` : null;
    const existing = id ? byKey.get(id) : undefined;
    if (existing) {
      existing.followers.push(repo);
      continue;
    }
    const group = { leader: repo, entry, followers: [] };
    groups.push(group);
    if (id) byKey.set(id, group);
  }
  return groups;
}

/**
 * Find each repository's implementation and review guidance into
 * `artifacts/repo-guidance/`. Best-effort: always resolves `true`, because the
 * agents that read the file work without it, and init runs this alongside
 * constraint discovery in one phase, whose retry a failure here would trigger.
 */
export function buildDiscoverGuidancePhase(input: {
  workspace: string;
  wsPath: string;
  repos: Repo[];
}): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Discover repo guidance",
    fn: async (ctx) => {
      try {
        const missing: Repo[] = [];
        for (const repo of input.repos) {
          if (!(await pathExists(repoGuidancePath(input.wsPath, repo.repoName)))) missing.push(repo);
        }
        if (missing.length === 0) return true;

        const groups = await applyCached(ctx, input.wsPath, missing);
        if (groups.length === 0) return true;

        const systemPromptFile = await ensureSystemPrompt(input.wsPath, "repo-guidance");
        const children: GroupChild[] = groups.map(({ leader }) => {
          const outputPath = repoGuidancePath(input.wsPath, leader.repoName);
          return {
            label: `guidance-${leader.repoName}`,
            stepType: STEP_TYPES.DISCOVER_GUIDANCE,
            prompt: buildRepoGuidancePrompt({
              workspaceName: input.workspace,
              repoName: leader.repoName,
              worktreePath: leader.worktreePath,
              outputPath,
            }),
            // Claude CLI marks an absolute path with a leading `//`.
            allowedTools: [`Write(/${outputPath})`, `Edit(/${outputPath})`],
            appendSystemPromptFile: systemPromptFile,
          };
        });

        ctx.emitStatus(`Discovering guidance for ${children.length} repositories`);
        const results = await ctx.runChildGroup(children);

        let found = 0;
        for (const [i, { leader, entry, followers }] of groups.entries()) {
          if (!results[i]) continue;
          const guidance = await readWritten(input.wsPath, leader.repoName);
          if (guidance === null) continue;
          found += 1;
          for (const follower of followers) await writeGuidance(input.wsPath, follower.repoName, guidance);
          if (entry) await writeRepoGuidanceCache(entry, guidance);
        }
        ctx.emitStatus(`Guidance discovery complete: ${found}/${groups.length} written`);
      } catch (err) {
        ctx.emitStatus(`Guidance discovery failed, continuing without it: ${err}`);
      }
      return true;
    },
  };
}
