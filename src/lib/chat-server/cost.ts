import os from "node:os";
import path from "node:path";
import { globScan } from "@/lib/fs";
import { insertClaudeRun, insertPendingChatCost, listPendingChatCostIds, takePendingChatCost } from "@/lib/db";
import { transcriptCostStateSchema } from "@/lib/runtime-schemas";
import { totalModelUsage } from "@/lib/parsers/run-usage";
import type { RunUsage } from "@/lib/parsers/run-usage";

type SessionTotals = Omit<RunUsage, "numTurns">;

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/**
 * The latest cumulative totals in a CLI session's transcript, or undefined when
 * there is no transcript or it has no cost-state line yet. The transcript sits
 * under a directory named after the session's cwd, so it is found by file name.
 */
async function readSessionTotals(cliSessionId: string): Promise<SessionTotals | undefined> {
  const projects = path.join(claudeConfigDir(), "projects");
  let files: string[];
  try {
    files = await globScan(new Bun.Glob(`*/${cliSessionId}.jsonl`), projects);
  } catch {
    return undefined;
  }
  if (files.length === 0) return undefined;

  const lines = (await Bun.file(path.join(projects, files[0])).text()).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"cost-state"')) continue;
    try {
      const parsed = transcriptCostStateSchema.safeParse(JSON.parse(lines[i]));
      if (!parsed.success) return undefined;
      return {
        ...totalModelUsage(parsed.data.modelUsage),
        costUsd: parsed.data.totalCostUSD,
        durationMs: parsed.data.totalAPIDuration,
      };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Start tracking a chat's cost. A resumed session's transcript already holds
 * the totals of its earlier runs, so those are kept as the baseline.
 */
export async function beginChatCost(
  meta: { workspace: string; agentName: string },
  cliSessionId: string,
  opts: { resumed: boolean },
): Promise<void> {
  const baseline = opts.resumed ? await readSessionTotals(cliSessionId) : undefined;
  insertPendingChatCost({
    cliSessionId,
    workspace: meta.workspace,
    agentName: meta.agentName,
    baseline: baseline ? JSON.stringify(baseline) : null,
  });
}

/**
 * Record what a finished chat spent: its transcript's totals less the baseline.
 * Duration is API time, since a chat sits open idle.
 */
export async function settleChatCost(cliSessionId: string): Promise<void> {
  const pending = takePendingChatCost(cliSessionId);
  if (!pending) return;
  const after = await readSessionTotals(cliSessionId);
  if (!after) return;
  const baseline = pending.baseline ? (JSON.parse(pending.baseline) as SessionTotals) : undefined;
  const minus = (k: keyof Omit<SessionTotals, "model">) => after[k] - (baseline?.[k] ?? 0);
  const costUsd = minus("costUsd");
  if (costUsd <= 0) return;

  insertClaudeRun({
    operationId: cliSessionId,
    operationType: "chat",
    workspace: pending.workspace,
    phaseLabel: null,
    childLabel: pending.agentName,
    stepType: null,
    effort: null,
    model: after.model,
    costUsd,
    durationMs: minus("durationMs"),
    numTurns: 0,
    inputTokens: minus("inputTokens"),
    cacheCreationTokens: minus("cacheCreationTokens"),
    cacheReadTokens: minus("cacheReadTokens"),
    outputTokens: minus("outputTokens"),
  });
}

/**
 * Settle chats whose exit this process never saw — the chat server stopped
 * while they ran. Sessions still alive (a hot reload keeps them) stay pending.
 */
export async function settleOrphanedChatCosts(liveCliSessionIds: ReadonlySet<string>): Promise<void> {
  for (const id of listPendingChatCostIds()) {
    if (!liveCliSessionIds.has(id)) await settleChatCost(id);
  }
}
