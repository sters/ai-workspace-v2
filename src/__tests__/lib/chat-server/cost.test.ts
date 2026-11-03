// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDb, _resetDb, _setDbPath, listClaudeRuns } from "@/lib/db";
import { beginChatCost, settleChatCost, settleOrphanedChatCosts } from "@/lib/chat-server/cost";

const SESSION = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";

function costState(totalCostUSD: number, opusOut: number) {
  return JSON.stringify({
    type: "cost-state",
    totalCostUSD,
    totalAPIDuration: 90_000,
    totalDuration: 9_000_000,
    modelUsage: {
      "claude-opus-5-5": { inputTokens: 10, outputTokens: opusOut, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: totalCostUSD },
    },
  });
}

describe("chat cost recording", () => {
  let configDir: string;
  let projectDir: string;
  const transcript = (id: string) => path.join(projectDir, `${id}.jsonl`);
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const meta = { workspace: "ws-1", agentName: "review-chat" };

  beforeEach(async () => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    configDir = await mkdtemp(path.join(os.tmpdir(), "aiw-chat-cost-"));
    process.env.CLAUDE_CONFIG_DIR = configDir;
    projectDir = path.join(configDir, "projects", "-some-workspace-root");
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
    await rm(configDir, { recursive: true, force: true });
  });

  it("records a new chat's final cost-state when it settles, once", async () => {
    await beginChatCost(meta, SESSION, { resumed: false });
    await writeFile(transcript(SESSION), `${JSON.stringify({ type: "user" })}\n${costState(1.5, 200)}\n`);

    await settleChatCost(SESSION);
    await settleChatCost(SESSION);

    expect(listClaudeRuns("")).toEqual([expect.objectContaining({
      operationId: SESSION,
      operationType: "chat",
      workspace: "ws-1",
      childLabel: "review-chat",
      model: "claude-opus-5-5",
      costUsd: 1.5,
      durationMs: 90_000,
      outputTokens: 200,
    })]);
  });

  it("counts only what a resumed session added, since cost-state carries over across resumes", async () => {
    await writeFile(transcript(SESSION), `${costState(1.0, 100)}\n`);
    await beginChatCost(meta, SESSION, { resumed: true });
    await appendFile(transcript(SESSION), `${costState(1.75, 160)}\n`);

    await settleChatCost(SESSION);

    expect(listClaudeRuns("")[0]).toMatchObject({ costUsd: 0.75, outputTokens: 60, durationMs: 0 });
  });

  it("records nothing when the transcript is missing or the chat spent nothing", async () => {
    await beginChatCost(meta, OTHER, { resumed: false });
    await settleChatCost(OTHER);
    await writeFile(transcript(SESSION), `${costState(1.0, 100)}\n`);
    await beginChatCost(meta, SESSION, { resumed: true });
    await settleChatCost(SESSION);

    expect(listClaudeRuns("")).toEqual([]);
  });

  it("settles chats that ended while the server was down, leaving live ones open", async () => {
    await beginChatCost(meta, SESSION, { resumed: false });
    await beginChatCost(meta, OTHER, { resumed: false });
    await writeFile(transcript(SESSION), `${costState(2, 10)}\n`);
    await writeFile(transcript(OTHER), `${costState(3, 10)}\n`);

    await settleOrphanedChatCosts(new Set([OTHER]));
    expect(listClaudeRuns("").map((r) => r.operationId)).toEqual([SESSION]);

    await settleChatCost(OTHER);
    expect(listClaudeRuns("").map((r) => r.operationId)).toEqual([SESSION, OTHER]);
  });
});
