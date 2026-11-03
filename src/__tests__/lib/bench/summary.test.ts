import { describe, expect, it } from "vitest";
import { summarizeBench } from "@/lib/bench/summary";

const gate = (shouldLoop: boolean) => JSON.stringify({ shouldLoop, giveUp: false, reason: "", unfinishedRepositories: [] });

describe("summarizeBench", () => {
  const attempts = [
    { label: "opus/medium #1", config: "opus/medium", ok: true, text: gate(true) },
    { label: "opus/medium #2", config: "opus/medium", ok: true, text: gate(true) },
    { label: "claude-haiku-5-5/max #1", config: "claude-haiku-5-5/max", ok: true, text: gate(false) },
    { label: "claude-haiku-5-5/max #2", config: "claude-haiku-5-5/max", ok: false, text: "" },
  ];
  const costs = new Map([
    ["opus/medium #1", { costUsd: 1, durationMs: 60_000 }],
    ["opus/medium #2", { costUsd: 3, durationMs: 120_000 }],
    ["claude-haiku-5-5/max #1", { costUsd: 0.2, durationMs: 30_000 }],
  ]);

  it("averages cost and time per configuration over the attempts that ran", () => {
    const rows = summarizeBench("autonomous-gate", "opus/medium", attempts, costs);
    expect(rows.find((r) => r.config === "opus/medium")).toMatchObject({ attempts: 2, succeeded: 2, avgCostUsd: 2, avgDurationMs: 90_000 });
    expect(rows.find((r) => r.config === "claude-haiku-5-5/max")).toMatchObject({ attempts: 2, succeeded: 1, avgCostUsd: 0.2 });
  });

  it("scores each configuration against the reference's first answer, the reference's own repeats included", () => {
    const rows = summarizeBench("autonomous-gate", "opus/medium", attempts, costs);
    // The reference's second run agrees with its first: the noise floor.
    expect(rows.find((r) => r.config === "opus/medium")!.agreement).toBe(1);
    // shouldLoop differs, giveUp agrees.
    expect(rows.find((r) => r.config === "claude-haiku-5-5/max")!.agreement).toBe(0.5);
  });

  it("leaves agreement unknown when the reference produced no readable answer", () => {
    const rows = summarizeBench("autonomous-gate", "opus/medium", attempts.map((a) => (a.config === "opus/medium" ? { ...a, text: "" } : a)), costs);
    expect(rows.every((r) => r.agreement === null)).toBe(true);
  });
});
