import { describe, expect, it } from "vitest";
import { priceRun } from "@/lib/pricing";

const tokens = { inputTokens: 1_000_000, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 };

describe("priceRun", () => {
  it("prices each model at its own list rates, whatever the CLI reported", () => {
    // $2 input + $4 1h cache write + $0.20 cache read + $10 output
    expect(priceRun({ model: "claude-sonnet-5-5", costUsd: 999, ...tokens }, "1h")).toBeCloseTo(16.2);
    expect(priceRun({ model: "claude-opus-5-5", costUsd: 999, ...tokens }, "1h")).toBeCloseTo(32.2);
  });

  it("charges cache writes at 1.25x input on a 5-minute TTL instead of 2x", () => {
    expect(priceRun({ model: "claude-opus-5-5", costUsd: 0, ...tokens }, "5m")).toBeCloseTo(4 + 5 + 0.2 + 20);
  });

  it("prices the 1M-context variant like its base model", () => {
    expect(priceRun({ model: "claude-opus-5-5[1m]", costUsd: 0, ...tokens }, "1h")).toBeCloseTo(32.2);
  });

  it("keeps the CLI's figure for a model it has no rates for", () => {
    expect(priceRun({ model: "claude-unknown-9", costUsd: 1.23, ...tokens }, "1h")).toBe(1.23);
    expect(priceRun({ model: null, costUsd: 1.23, ...tokens }, "5m")).toBe(1.23);
  });
});
