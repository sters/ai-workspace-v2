import { statSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { buildSearchPrompt, DEEP_SEARCH_SCHEMA } from "@/lib/templates/prompts/search";
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
          results.sort((a, b) => {
            try {
              const mtimeA = statSync(path.join(getWorkspaceDir(), a.workspaceName)).mtime.getTime();
              const mtimeB = statSync(path.join(getWorkspaceDir(), b.workspaceName)).mtime.getTime();
              return mtimeB - mtimeA;
            } catch {
              return 0;
            }
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
