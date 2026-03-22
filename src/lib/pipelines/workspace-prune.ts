import {
  listAllWorkspacesWithAge,
  deleteWorkspace,
} from "@/lib/workspace";
import type { PipelinePhase } from "@/types/pipeline";

export function buildWorkspacePrunePipeline(days: number): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Prune stale workspaces",
      fn: async (ctx) => {
        ctx.emitStatus(`Scanning workspaces (threshold: ${days} days)...`);
        const all = listAllWorkspacesWithAge(days);

        if (all.length === 0) {
          ctx.emitResult("No workspaces found.");
          return true;
        }

        // Log every workspace with age and whether it will be pruned
        for (const ws of all) {
          const daysUntilStale = days - ws.ageDays;
          if (ws.isStale) {
            ctx.emitStatus(
              `  [STALE]  ${ws.name}  (${ws.ageDays}d old, last modified: ${ws.lastModified.toISOString()})`,
            );
          } else {
            ctx.emitStatus(
              `  [KEEP]   ${ws.name}  (${ws.ageDays}d old, ${daysUntilStale}d until stale)`,
            );
          }
        }

        const stale = all.filter((ws) => ws.isStale);

        if (stale.length === 0) {
          ctx.emitResult(`All ${all.length} workspace(s) are within ${days} days. Nothing to prune.`);
          return true;
        }

        // Ask user for confirmation before deleting
        const staleList = stale.map((ws) => `${ws.name} (${ws.ageDays}d old)`).join("\n");
        const answers = await ctx.emitAsk([
          {
            question: `Delete ${stale.length} stale workspace(s)?\n\n${staleList}`,
            options: [
              { label: "Delete all", description: `Delete all ${stale.length} stale workspace(s)` },
              { label: "Cancel", description: "Do not delete any workspaces" },
            ],
          },
        ]);

        const answer = Object.values(answers)[0] ?? "";
        if (answer === "Cancel") {
          ctx.emitResult("Prune cancelled by user.");
          return true;
        }

        ctx.emitStatus(`Deleting ${stale.length} of ${all.length} workspace(s)...`);

        let deleted = 0;
        let failedCount = 0;

        for (const ws of stale) {
          if (ctx.signal.aborted) break;
          try {
            await deleteWorkspace(ws.name);
            deleted++;
            ctx.emitStatus(`  Deleted: ${ws.name}`);
          } catch (err) {
            failedCount++;
            const message = err instanceof Error ? err.message : String(err);
            ctx.emitStatus(`  Failed: ${ws.name} (${message})`);
          }
        }

        ctx.emitResult(
          `Done. Deleted ${deleted}/${stale.length} workspace(s)` +
            (failedCount > 0 ? `, ${failedCount} failed` : ""),
        );
        return failedCount === 0;
      },
    },
  ];
}
