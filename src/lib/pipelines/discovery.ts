/**
 * Pipeline for workspace discovery.
 * Picks up to 5 recent workspaces, runs Claude in parallel per workspace,
 * and saves discovered suggestions to DB.
 */

import { listOperations } from "@/lib/db/operations";
import { listWorkspaces } from "@/lib/workspace/reader";
import { getReadme } from "@/lib/workspace/reader";
import { buildDiscoveryPrompt, DISCOVERY_SCHEMA } from "@/lib/templates";
import { insertSuggestion } from "@/lib/db";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import type { DiscoveryInput } from "@/types/prompts";

const MAX_WORKSPACES = 5;

export function buildDiscoveryPipeline(): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Discover workspaces",
      timeoutMs: 5 * 60 * 1000,
      fn: async (ctx) => {
        ctx.emitStatus("Listing workspaces...");

        const workspaces = await listWorkspaces();
        if (workspaces.length === 0) {
          ctx.emitResult("No workspaces found.");
          return true;
        }

        // Pick the most recently modified workspaces (already sorted by lastModified desc)
        const targets = workspaces.slice(0, MAX_WORKSPACES);
        const allNames = workspaces.map((ws) => ws.name);

        ctx.emitStatus(`Building prompts for ${targets.length} workspace(s)...`);

        // Build a prompt per workspace
        const resultTexts = new Map<string, string>();
        const children: GroupChild[] = [];

        for (const ws of targets) {
          // Get operations for this workspace
          const ops = listOperations(ws.name)
            .filter((op) => op.status === "completed")
            .slice(0, 10);

          // Read README content
          const readmeContent = (await getReadme(ws.name)) ?? "";

          const input: DiscoveryInput = {
            workspace: {
              name: ws.name,
              title: ws.meta.title,
              taskType: ws.meta.taskType,
              progress: ws.overallProgress,
              repositories: ws.meta.repositories.map((r) => r.alias),
              readmeContent,
              todos: ws.todos.map((t) => ({
                repoName: t.repoName,
                completed: t.completed,
                pending: t.pending,
                blocked: t.blocked,
                total: t.total,
              })),
            },
            operations: ops.map((op) => ({
              type: op.type,
              completedAt: op.completedAt ?? op.startedAt,
              inputs: (op.inputs as Record<string, unknown>) ?? {},
              resultSummary: op.resultSummary?.content ?? "",
            })),
            otherWorkspaceNames: allNames.filter((n) => n !== ws.name),
          };

          const prompt = buildDiscoveryPrompt(input);

          children.push({
            label: ws.name,
            prompt,
            jsonSchema: DISCOVERY_SCHEMA as Record<string, unknown>,
            skipAskUserQuestion: true,
            onResultText: (text) => {
              resultTexts.set(ws.name, text);
            },
          });
        }

        ctx.emitStatus(`Analyzing ${children.length} workspace(s) in parallel...`);

        const results = await ctx.runChildGroup(children);

        // Collect and save suggestions from all workspaces
        let totalSaved = 0;
        for (let i = 0; i < targets.length; i++) {
          const wsName = targets[i].name;
          if (!results[i]) {
            ctx.emitStatus(`[${wsName}] Analysis failed`);
            continue;
          }

          const text = resultTexts.get(wsName);
          if (!text) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            ctx.emitStatus(`[${wsName}] Failed to parse JSON`);
            continue;
          }

          if (typeof parsed !== "object" || parsed === null || !("suggestions" in parsed)) continue;
          const { suggestions } = parsed as { suggestions: unknown };
          if (!Array.isArray(suggestions)) continue;

          let count = 0;
          for (const s of suggestions) {
            if (typeof s !== "object" || s === null) continue;
            const item = s as Record<string, unknown>;
            if (typeof item.title !== "string" || typeof item.description !== "string") continue;
            insertSuggestion({
              id: crypto.randomUUID(),
              sourceWorkspace: wsName,
              sourceOperationId: ctx.operationId,
              title: item.title,
              description: item.description,
            });
            count++;
          }

          if (count > 0) {
            ctx.emitStatus(`[${wsName}] Found ${count} suggestion(s)`);
          } else {
            ctx.emitStatus(`[${wsName}] No suggestions`);
          }
          totalSaved += count;
        }

        ctx.emitResult(`Discovered ${totalSaved} workspace candidate${totalSaved !== 1 ? "s" : ""} from ${targets.length} workspace(s). Check the Suggestions List tab.`);
        return true;
      },
    },
  ];
}
