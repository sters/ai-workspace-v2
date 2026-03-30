/**
 * Pipeline for suggestion aggregation.
 * Reads all active suggestions, calls Claude to identify similar ones,
 * and merges them into consolidated entries.
 *
 * Three phases:
 *  1. Load suggestions from DB and build the prompt
 *  2. Call Claude with structured output to identify merge groups
 *  3. Validate the result and apply DB changes (dismiss + insert)
 */

import { listActiveSuggestions, dismissSuggestion, insertSuggestion } from "@/lib/db";
import { buildSuggestionAggregatorPrompt, SUGGESTION_AGGREGATION_SCHEMA } from "@/lib/templates";
import type { PipelinePhase } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import type { WorkspaceSuggestion } from "@/types/suggestion";

export function buildAggregateSuggestionsPipeline(): PipelinePhase[] {
  // Shared state across phases (closure variables)
  let suggestions: WorkspaceSuggestion[] = [];
  let prompt = "";
  let resultText: string | undefined;

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

        prompt = buildSuggestionAggregatorPrompt({
          suggestions: suggestions.map((s) => ({
            id: s.id,
            targetRepository: s.targetRepository,
            title: s.title,
            description: s.description,
          })),
        });

        ctx.emitResult(`Loaded ${suggestions.length} suggestions.`);
        return true;
      },
    },

    // ── Phase 2: Call Claude ───────────────────────────────────────────
    {
      kind: "function",
      label: "Analyze with Claude",
      timeoutMs: 10 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        if (suggestions.length < 2) return true;

        ctx.emitStatus(
          `Analyzing ${suggestions.length} suggestions with Claude...`,
        );

        const success = await ctx.runChild("aggregate", prompt, {
          jsonSchema: SUGGESTION_AGGREGATION_SCHEMA as Record<string, unknown>,
          skipAskUserQuestion: true,
          stepType: STEP_TYPES.AGGREGATE_SUGGESTIONS,
          onResultText: (text) => {
            resultText = text;
          },
        });

        if (!success) {
          ctx.emitResult("Claude child process failed.");
          return false;
        }
        if (!resultText) {
          ctx.emitResult(
            "Claude completed but no structured output was captured. Check CLI logs.",
          );
          return false;
        }

        ctx.emitResult("Analysis complete.");
        return true;
      },
    },

    // ── Phase 3: Apply aggregation ────────────────────────────────────
    {
      kind: "function",
      label: "Apply aggregation",
      maxRetries: 0,
      fn: async (ctx) => {
        if (suggestions.length < 2) return true;
        if (!resultText) return false;

        let parsed: { groups: AggregationGroup[]; unchangedIds: string[] };
        try {
          parsed = JSON.parse(resultText);
        } catch {
          ctx.emitResult("Failed to parse Claude response as JSON.");
          return false;
        }

        // Validate: every original ID appears exactly once
        const originalIds = new Set(suggestions.map((s) => s.id));
        const seenIds = new Set<string>();

        for (const group of parsed.groups) {
          for (const id of group.mergedIds) {
            if (!originalIds.has(id)) {
              ctx.emitResult(`Unknown suggestion ID "${id}" in response.`);
              return false;
            }
            if (seenIds.has(id)) {
              ctx.emitResult(`Duplicate ID "${id}" in response.`);
              return false;
            }
            seenIds.add(id);
          }
        }
        for (const id of parsed.unchangedIds) {
          if (originalIds.has(id)) seenIds.add(id);
        }

        // Process merge groups (only those with 2+ suggestions)
        const mergeGroups = parsed.groups.filter((g) => g.mergedIds.length >= 2);

        if (mergeGroups.length === 0) {
          ctx.emitResult(
            "No similar suggestions found. All suggestions are unique.",
          );
          return true;
        }

        const suggestionMap = new Map(suggestions.map((s) => [s.id, s]));
        let totalDismissed = 0;
        let totalInserted = 0;

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
            totalDismissed++;
          }

          insertSuggestion({
            id: crypto.randomUUID(),
            sourceWorkspace: mostRecent.sourceWorkspace,
            sourceOperationId: ctx.operationId,
            targetRepository: group.targetRepository,
            title: group.title,
            description: group.description,
          });
          totalInserted++;

          ctx.emitStatus(
            `Merged ${group.mergedIds.length} suggestions → "${group.title}"`,
          );
        }

        ctx.emitResult(
          `Aggregated ${totalDismissed} suggestions into ${totalInserted} merged entry(ies). ${suggestions.length - totalDismissed} unchanged.`,
        );
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
