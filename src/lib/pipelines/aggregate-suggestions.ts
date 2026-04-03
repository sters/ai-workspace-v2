/**
 * Pipeline for suggestion aggregation.
 * Reads all active suggestions, calls Claude to identify similar ones,
 * and merges them into consolidated entries.
 *
 * Loops until no further aggregation is possible:
 *  1. Load suggestions from DB
 *  2. Aggregate loop: repeatedly analyze with Claude and apply merges
 *     until Claude finds no more groups to merge or fewer than 2
 *     suggestions remain
 */

import { listActiveSuggestions, dismissSuggestion, insertSuggestion } from "@/lib/db";
import { buildSuggestionAggregatorPrompt, SUGGESTION_AGGREGATION_SCHEMA } from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import type { WorkspaceSuggestion } from "@/types/suggestion";

/** Safety cap to prevent runaway loops. */
const MAX_AGGREGATE_ITERATIONS = 10;

export function buildAggregateSuggestionsPipeline(): PipelinePhase[] {
  let suggestions: WorkspaceSuggestion[] = [];

  return [
    // ── Phase 1: Load suggestions ──────────────────────────────────────
    {
      kind: "function",
      label: "Load suggestions",
      maxRetries: 0,
      fn: async (ctx) => {
        ctx.emitStatus("Reading active suggestions from database...");
        suggestions = listActiveSuggestions();

        if (suggestions.length < 2) {
          ctx.emitResult(
            `Only ${suggestions.length} suggestion(s) found. Need at least 2 to aggregate.`,
          );
          return true;
        }

        ctx.emitResult(`Loaded ${suggestions.length} suggestions.`);
        return true;
      },
    },

    // ── Phase 2: Aggregate loop ────────────────────────────────────────
    {
      kind: "function",
      label: "Aggregate loop",
      timeoutMs: 30 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        if (suggestions.length < 2) return true;

        let grandTotalDismissed = 0;
        let grandTotalInserted = 0;

        for (let iteration = 1; iteration <= MAX_AGGREGATE_ITERATIONS; iteration++) {
          ctx.emitStatus(
            `[Iteration ${iteration}] Analyzing ${suggestions.length} suggestions with Claude...`,
          );

          // ── Call Claude ──────────────────────────────────────────────
          const prompt = buildSuggestionAggregatorPrompt({
            suggestions: suggestions.map((s) => ({
              id: s.id,
              targetRepository: s.targetRepository,
              title: s.title,
              description: s.description,
            })),
          });

          let resultText: string | undefined;
          const success = await ctx.runChild(`aggregate-${iteration}`, prompt, {
            jsonSchema: SUGGESTION_AGGREGATION_SCHEMA as Record<string, unknown>,
            skipAskUserQuestion: true,
            stepType: STEP_TYPES.AGGREGATE_SUGGESTIONS,
            onResultText: (text) => {
              resultText = text;
            },
          });

          if (!success) {
            ctx.emitResult(
              `[Iteration ${iteration}] Claude child process failed.`,
            );
            return false;
          }
          if (!resultText) {
            ctx.emitResult(
              `[Iteration ${iteration}] Claude completed but no structured output was captured.`,
            );
            return false;
          }

          // ── Parse & validate ─────────────────────────────────────────
          let parsed: { groups: AggregationGroup[]; unchangedIds: string[] };
          try {
            parsed = JSON.parse(resultText);
          } catch {
            ctx.emitResult(
              `[Iteration ${iteration}] Failed to parse Claude response as JSON.`,
            );
            return false;
          }

          const originalIds = new Set(suggestions.map((s) => s.id));
          const seenIds = new Set<string>();

          for (const group of parsed.groups) {
            for (const id of group.mergedIds) {
              if (!originalIds.has(id)) {
                ctx.emitResult(
                  `[Iteration ${iteration}] Unknown suggestion ID "${id}" in response.`,
                );
                return false;
              }
              if (seenIds.has(id)) {
                ctx.emitResult(
                  `[Iteration ${iteration}] Duplicate ID "${id}" in response.`,
                );
                return false;
              }
              seenIds.add(id);
            }
          }
          for (const id of parsed.unchangedIds) {
            if (originalIds.has(id)) seenIds.add(id);
          }

          const mergeGroups = parsed.groups.filter(
            (g) => g.mergedIds.length >= 2,
          );

          // ── No merges → converged ────────────────────────────────────
          if (mergeGroups.length === 0) {
            ctx.emitStatus(
              `[Iteration ${iteration}] No further merges found. Converged.`,
            );
            break;
          }

          // ── Apply merges ─────────────────────────────────────────────
          const suggestionMap = new Map(suggestions.map((s) => [s.id, s]));
          let iterDismissed = 0;
          let iterInserted = 0;

          for (const group of mergeGroups) {
            const originals = group.mergedIds
              .map((id) => suggestionMap.get(id)!)
              .sort(
                (a: WorkspaceSuggestion, b: WorkspaceSuggestion) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              );
            const mostRecent = originals[0];

            for (const id of group.mergedIds) {
              dismissSuggestion(id);
              iterDismissed++;
            }

            insertSuggestion({
              id: crypto.randomUUID(),
              sourceWorkspace: mostRecent.sourceWorkspace,
              sourceOperationId: ctx.operationId,
              targetRepository: group.targetRepository,
              title: group.title,
              description: group.description,
            });
            iterInserted++;

            ctx.emitStatus(
              `[Iteration ${iteration}] Merged ${group.mergedIds.length} → "${group.title}"`,
            );
          }

          grandTotalDismissed += iterDismissed;
          grandTotalInserted += iterInserted;

          ctx.emitStatus(
            `[Iteration ${iteration}] Merged ${iterDismissed} into ${iterInserted}. Checking if further aggregation is possible...`,
          );

          // ── Reload for next iteration ────────────────────────────────
          suggestions = listActiveSuggestions();
          if (suggestions.length < 2) {
            ctx.emitStatus("Fewer than 2 suggestions remain. Done.");
            break;
          }
        }

        if (grandTotalDismissed === 0) {
          ctx.emitResult(
            "No similar suggestions found. All suggestions are unique.",
          );
        } else {
          const remaining = listActiveSuggestions().length;
          ctx.emitResult(
            `Aggregated ${grandTotalDismissed} suggestions into ${grandTotalInserted} merged entry(ies) across multiple iterations. ${remaining} suggestion(s) remain.`,
          );
        }

        return true;
      },
    },
  ];
}

interface AggregationGroup {
  mergedIds: string[];
  targetRepository: string;
  title: string;
  description: string;
}
