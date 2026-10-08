import { stat } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { buildSearchPrompt, DEEP_SEARCH_SCHEMA } from "@/lib/templates/prompts/search";
import { ensureGlobalSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { DeepSearchResult } from "@/types/search";

export function buildSearchPipeline(query: string): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Deep search",
      timeoutMs: 10 * 60 * 1000,
      fn: async (ctx) => {
        ctx.emitStatus("Searching workspaces...");

        let resultText = "";
        const success = await ctx.runChild(
          "deep-search",
          buildSearchPrompt(query, getWorkspaceDir()),
          {
            cwd: getWorkspaceDir(),
            jsonSchema: DEEP_SEARCH_SCHEMA as Record<string, unknown>,
            stepType: STEP_TYPES.DEEP_SEARCH,
            appendSystemPromptFile: await ensureGlobalSystemPrompt("search"),
            onResultText: (text) => {
              resultText = text;
            },
          },
        );

        if (!success) {
          ctx.emitResult(JSON.stringify({ results: [], error: "Search failed" }));
          return false;
        }

        try {
          const parsed = JSON.parse(resultText);
          const results: DeepSearchResult[] = (parsed.results ?? []).map(
            (r: { workspaceName: string; title: string; excerpts: string[] }) => ({
              workspaceName: r.workspaceName,
              title: r.title,
              excerpts: r.excerpts ?? [],
            }),
          );

          // Sort by last modified (most recent first), same as listWorkspaces()
          const mtimes = new Map(await Promise.all(results.map(async (r) => {
            try {
              return [r.workspaceName, (await stat(path.join(getWorkspaceDir(), r.workspaceName))).mtime.getTime()] as const;
            } catch {
              return [r.workspaceName, null] as const;
            }
          })));
          results.sort((a, b) => {
            const mtimeA = mtimes.get(a.workspaceName);
            const mtimeB = mtimes.get(b.workspaceName);
            return mtimeA == null || mtimeB == null ? 0 : mtimeB - mtimeA;
          });

          ctx.emitResult(JSON.stringify({ results }));
        } catch {
          ctx.emitResult(JSON.stringify({ results: [], error: "Failed to parse results" }));
          return false;
        }

        return true;
      },
    },
  ];
}
