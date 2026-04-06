/**
 * Pipeline for suggestion pruning.
 * Checks whether each active suggestion has already been addressed in its
 * target repository and dismisses resolved ones.
 *
 *  1. Load active suggestions and match them to local repositories
 *  2. Auto-dismiss suggestions whose target repo is not found locally
 *  3. For each matched repo, spawn Claude to check resolution status
 *  4. Dismiss suggestions that Claude identifies as resolved
 */

import { listActiveSuggestions, dismissSuggestion } from "@/lib/db";
import { listAllRepositories } from "@/lib/workspace";
import { buildSuggestionPrunerPrompt, SUGGESTION_PRUNE_SCHEMA } from "@/lib/templates";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import type { WorkspaceSuggestion } from "@/types/suggestion";
import type { WorkspaceRepo } from "@/types/workspace";

// ---------------------------------------------------------------------------
// Repo matching helper
// ---------------------------------------------------------------------------

/**
 * Match a suggestion's targetRepository to a local repo.
 * Tries: exact repoPath match, exact repoName match, repoPath suffix match.
 */
export function matchSuggestionToRepo(
  targetRepository: string,
  repos: WorkspaceRepo[],
): WorkspaceRepo | null {
  if (!targetRepository) return null;

  // 1. Exact repoPath match (e.g. "github.com/org/repo")
  const byPath = repos.find((r) => r.repoPath === targetRepository);
  if (byPath) return byPath;

  // 2. Exact repoName match (e.g. "repo")
  const byName = repos.find((r) => r.repoName === targetRepository);
  if (byName) return byName;

  // 3. Suffix match (e.g. "org/repo" matches "github.com/org/repo")
  const bySuffix = repos.find(
    (r) => r.repoPath.endsWith(`/${targetRepository}`),
  );
  if (bySuffix) return bySuffix;

  return null;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function buildPruneSuggestionsPipeline(): PipelinePhase[] {
  let grouped: Map<string, { repo: WorkspaceRepo; suggestions: WorkspaceSuggestion[] }>;
  let autoDismissed = 0;

  return [
    // ── Phase 1: Load and match ───────────────────────────────────────
    {
      kind: "function",
      label: "Load and match repositories",
      maxRetries: 0,
      fn: async (ctx) => {
        ctx.emitStatus("Reading active suggestions...");
        const suggestions = listActiveSuggestions();

        if (suggestions.length === 0) {
          ctx.emitResult("No active suggestions to prune.");
          return true;
        }

        ctx.emitStatus(`Found ${suggestions.length} suggestion(s). Discovering local repositories...`);
        const repos = listAllRepositories();
        ctx.emitStatus(`Found ${repos.length} local repository(ies).`);

        // Match and group
        grouped = new Map();
        const unmatched: WorkspaceSuggestion[] = [];

        for (const s of suggestions) {
          const repo = matchSuggestionToRepo(s.targetRepository, repos);
          if (!repo) {
            unmatched.push(s);
            continue;
          }
          const key = repo.worktreePath;
          if (!grouped.has(key)) {
            grouped.set(key, { repo, suggestions: [] });
          }
          grouped.get(key)!.suggestions.push(s);
        }

        // Auto-dismiss unmatched
        for (const s of unmatched) {
          dismissSuggestion(s.id);
          autoDismissed++;
          ctx.emitStatus(
            `Auto-dismissed "${s.title}" (repo "${s.targetRepository}" not found locally)`,
          );
        }

        if (grouped.size === 0) {
          ctx.emitResult(
            `All ${autoDismissed} suggestion(s) auto-dismissed (no matching local repositories).`,
          );
          return true;
        }

        const totalToCheck = [...grouped.values()].reduce(
          (sum, g) => sum + g.suggestions.length,
          0,
        );
        ctx.emitResult(
          `${totalToCheck} suggestion(s) across ${grouped.size} repo(s) to check with AI. ${autoDismissed} auto-dismissed.`,
        );
        return true;
      },
    },

    // ── Phase 2: Check with AI ────────────────────────────────────────
    {
      kind: "function",
      label: "Check resolution with AI",
      timeoutMs: 30 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        if (!grouped || grouped.size === 0) return true;

        const resultTexts = new Map<string, string>();
        const children: GroupChild[] = [];
        const repoKeys: string[] = [];

        for (const [key, { repo, suggestions }] of grouped) {
          repoKeys.push(key);
          const prompt = buildSuggestionPrunerPrompt({
            repoPath: repo.repoPath,
            suggestions: suggestions.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
            })),
          });

          children.push({
            label: repo.repoName,
            prompt,
            cwd: repo.worktreePath,
            jsonSchema: SUGGESTION_PRUNE_SCHEMA as Record<string, unknown>,
            skipAskUserQuestion: true,
            stepType: STEP_TYPES.PRUNE_SUGGESTIONS,
            onResultText: (text) => {
              resultTexts.set(key, text);
            },
          });
        }

        ctx.emitStatus(`Checking ${children.length} repo(s) in parallel...`);
        const results = await ctx.runChildGroup(children);

        let totalChecked = 0;
        let totalDismissed = 0;

        for (let i = 0; i < repoKeys.length; i++) {
          const key = repoKeys[i];
          const { repo, suggestions } = grouped.get(key)!;

          if (!results[i]) {
            ctx.emitStatus(`[${repo.repoName}] AI check failed`);
            continue;
          }

          const text = resultTexts.get(key);
          if (!text) {
            ctx.emitStatus(`[${repo.repoName}] No output from AI`);
            continue;
          }

          let parsed: { results: PruneResult[] };
          try {
            parsed = JSON.parse(text);
          } catch {
            ctx.emitStatus(`[${repo.repoName}] Failed to parse AI response`);
            continue;
          }

          if (!Array.isArray(parsed.results)) {
            ctx.emitStatus(`[${repo.repoName}] Invalid response structure`);
            continue;
          }

          const resultMap = new Map(
            parsed.results.map((r) => [r.id, r]),
          );

          for (const s of suggestions) {
            totalChecked++;
            const r = resultMap.get(s.id);
            if (r?.resolved) {
              dismissSuggestion(s.id);
              totalDismissed++;
              ctx.emitStatus(
                `[${repo.repoName}] Dismissed "${s.title}" -- ${r.reason}`,
              );
            } else if (r) {
              ctx.emitStatus(
                `[${repo.repoName}] Kept "${s.title}" -- ${r.reason}`,
              );
            }
          }
        }

        const remaining = listActiveSuggestions().length;
        ctx.emitResult(
          `Checked ${totalChecked} suggestion(s): ${totalDismissed} resolved (dismissed by AI), ${autoDismissed} auto-dismissed (no repo). ${remaining} suggestion(s) remain.`,
        );
        return true;
      },
    },
  ];
}

interface PruneResult {
  id: string;
  resolved: boolean;
  reason: string;
}
