import { listAllOperationLogsWithAge, deleteStoredOperation } from "@/lib/operation-store";
import type { PipelinePhase } from "@/types/pipeline";

export function buildOperationPrunePipeline(days: number): PipelinePhase[] {
  return [
    {
      kind: "function",
      label: "Prune old operation logs",
      fn: async (ctx) => {
        ctx.emitStatus(`Scanning operation logs (threshold: ${days} days)...`);
        const all = listAllOperationLogsWithAge(days);

        if (all.length === 0) {
          ctx.emitResult("No operation logs found.");
          return true;
        }

        for (const log of all) {
          const daysUntilStale = days - log.ageDays;
          if (log.isStale) {
            ctx.emitStatus(
              `  [STALE]  ${log.workspace}/${log.type}  (${log.ageDays}d old, started: ${log.startedAt})`,
            );
          } else {
            ctx.emitStatus(
              `  [KEEP]   ${log.workspace}/${log.type}  (${log.ageDays}d old, ${daysUntilStale}d until stale)`,
            );
          }
        }

        const stale = all.filter((log) => log.isStale);

        if (stale.length === 0) {
          ctx.emitResult(`All ${all.length} operation log(s) are within ${days} days. Nothing to prune.`);
          return true;
        }

        const staleList = stale
          .map((log) => `${log.workspace}/${log.type} (${log.ageDays}d old)`)
          .join("\n");
        const answers = await ctx.emitAsk([
          {
            question: `Delete ${stale.length} old operation log(s)?\n\n${staleList}`,
            options: [
              { label: "Delete all", description: `Delete all ${stale.length} old operation log(s)` },
              { label: "Cancel", description: "Do not delete any logs" },
            ],
          },
        ]);

        const answer = Object.values(answers)[0] ?? "";
        if (answer === "Cancel") {
          ctx.emitResult("Prune cancelled by user.");
          return true;
        }

        ctx.emitStatus(`Deleting ${stale.length} of ${all.length} operation log(s)...`);

        let deleted = 0;
        let failedCount = 0;

        for (const log of stale) {
          if (ctx.signal.aborted) break;
          try {
            deleteStoredOperation(log.operationId, log.workspace);
            deleted++;
            ctx.emitStatus(`  Deleted: ${log.workspace}/${log.type} (${log.operationId})`);
          } catch (err) {
            failedCount++;
            const message = err instanceof Error ? err.message : String(err);
            ctx.emitStatus(`  Failed: ${log.workspace}/${log.type} (${message})`);
          }
        }

        ctx.emitResult(
          `Done. Deleted ${deleted}/${stale.length} operation log(s)` +
            (failedCount > 0 ? `, ${failedCount} failed` : ""),
        );
        return failedCount === 0;
      },
    },
  ];
}
