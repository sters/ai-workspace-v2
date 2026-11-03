// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDb, _resetDb, _setDbPath, listClaudeRuns } from "@/lib/db";
import { readChatCostBaseline, recordChatCost } from "@/lib/chat-server/cost";

const SESSION = "11111111-2222-3333-4444-555555555555";

function costState(totalCostUSD: number, opusOut: number) {
  return JSON.stringify({
    type: "cost-state",
    sessionId: SESSION,
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
  let transcript: string;
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(async () => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    configDir = await mkdtemp(path.join(os.tmpdir(), "aiw-chat-cost-"));
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const projectDir = path.join(configDir, "projects", "-some-workspace-root");
    await mkdir(projectDir, { recursive: true });
    transcript = path.join(projectDir, `${SESSION}.jsonl`);
  });

  afterEach(async () => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
    await rm(configDir, { recursive: true, force: true });
  });

  const meta = { chatSessionId: "chat-1", workspace: "ws-1", agentName: "review-chat" };

  it("records the session's final cost-state for a new chat", async () => {
    await writeFile(transcript, `${JSON.stringify({ type: "user" })}\n${costState(1.5, 200)}\n`);

    await recordChatCost(meta, SESSION, await readChatCostBaseline("no-such-session"));

    expect(listClaudeRuns("")).toEqual([expect.objectContaining({
      operationId: "chat-1",
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
    await writeFile(transcript, `${costState(1.0, 100)}\n`);
    const baseline = await readChatCostBaseline(SESSION);
    await appendFile(transcript, `${costState(1.75, 160)}\n`);

    await recordChatCost(meta, SESSION, baseline);

    expect(listClaudeRuns("")[0]).toMatchObject({ costUsd: 0.75, outputTokens: 60, durationMs: 0 });
  });

  it("records nothing when the transcript is missing or the chat spent nothing", async () => {
    await recordChatCost(meta, "no-such-session", undefined);
    await writeFile(transcript, `${costState(1.0, 100)}\n`);
    await recordChatCost(meta, SESSION, await readChatCostBaseline(SESSION));

    expect(listClaudeRuns("")).toEqual([]);
  });
});
