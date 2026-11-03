import os from "node:os";
import path from "node:path";
import { globScan } from "@/lib/fs";
import { insertClaudeRun } from "@/lib/db";
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

/** Read before a chat (re)opens a CLI session, so its cost can be told from what came before. */
export const readChatCostBaseline = readSessionTotals;

/**
 * Record what a finished chat spent: the session's totals less the baseline
 * read when it started. Duration is API time, since a chat sits open idle.
 */
export async function recordChatCost(
  meta: { chatSessionId: string; workspace: string; agentName: string },
  cliSessionId: string,
  baseline: SessionTotals | undefined,
): Promise<void> {
  const after = await readSessionTotals(cliSessionId);
  if (!after) return;
  const minus = (k: keyof Omit<SessionTotals, "model">) => after[k] - (baseline?.[k] ?? 0);
  const costUsd = minus("costUsd");
  if (costUsd <= 0) return;

  insertClaudeRun({
    operationId: meta.chatSessionId,
    operationType: "chat",
    workspace: meta.workspace,
    phaseLabel: null,
    childLabel: meta.agentName,
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
