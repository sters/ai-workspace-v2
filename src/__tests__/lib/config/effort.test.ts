import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveEffort, resolveModel, STEP_DEFAULT_EFFORTS, STEP_DEFAULT_MODELS } from "@/lib/config/model";
import { _resetConfig, _setConfigFilePath } from "@/lib/config/resolver";
import { CLAUDE_EFFORTS } from "@/types/claude";
import { STEP_TYPES } from "@/types/pipeline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";

function writeTempConfig(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "effort-test-"));
  const filePath = path.join(dir, "config.yml");
  fs.writeFileSync(filePath, stringify(config), "utf-8");
  return filePath;
}

describe("CLAUDE_EFFORTS", () => {
  it("includes every level the Claude CLI accepts", () => {
    expect(Object.values(CLAUDE_EFFORTS)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("resolveEffort", () => {
  let tmpConfigPath: string | null = null;

  beforeEach(() => {
    _resetConfig();
  });

  afterEach(() => {
    _resetConfig();
    _setConfigFilePath(null);
    if (tmpConfigPath) {
      try { fs.rmSync(path.dirname(tmpConfigPath), { recursive: true, force: true }); } catch { /* ignore */ }
      tmpConfigPath = null;
    }
  });

  function setConfig(config: Record<string, unknown>) {
    tmpConfigPath = writeTempConfig(config);
    _setConfigFilePath(tmpConfigPath);
    _resetConfig();
  }

  it("returns undefined when no step type is given and nothing is configured", () => {
    setConfig({});
    expect(resolveEffort("execute")).toBeUndefined();
  });

  it("returns explicitEffort when provided (highest priority)", () => {
    setConfig({ operations: { effort: "medium" } });
    expect(resolveEffort("execute", "execute", "max")).toBe("max");
  });

  it("returns global operations.effort", () => {
    setConfig({ operations: { effort: "medium" } });
    expect(resolveEffort("review")).toBe("medium");
  });

  it("returns operation type effort over global", () => {
    setConfig({
      operations: {
        effort: "medium",
        execute: { effort: "xhigh" },
      },
    });
    expect(resolveEffort("execute")).toBe("xhigh");
    expect(resolveEffort("review")).toBe("medium");
  });

  it("returns step effort over operation type effort", () => {
    setConfig({
      operations: {
        effort: "low",
        review: {
          effort: "medium",
          steps: {
            "code-review": { effort: "xhigh" },
          },
        },
      },
    });
    expect(resolveEffort("review", "code-review")).toBe("xhigh");
    expect(resolveEffort("review", "verify-todo")).toBe("medium");
    expect(resolveEffort("review")).toBe("medium");
  });

  it("reserves high for genuinely open-ended work", () => {
    setConfig({});
    // Writes the done-contract, then the plan the executor follows.
    expect(resolveEffort("init", "analyze-readme")).toBe("high");
    expect(resolveEffort("init", "plan-todo")).toBe("high");
    // Hunts defects in a diff with no checklist to work from.
    expect(resolveEffort("review", "code-review")).toBe("high");
    // Reads the *other* repos' source to resolve [CROSS-REPO] placeholders.
    expect(resolveEffort("init", "coordinate-todos")).toBe("high");
    // The findings are the research operation's deliverable, not a step toward one.
    expect(resolveEffort("execute", "research")).toBe("high");
    // Judges between, and merges, implementations it did not write.
    expect(resolveEffort("execute", "best-of-n-reviewer")).toBe("high");
    // The one step tiered by payoff rather than shape: a ~60s sonnet call whose
    // wrong answer costs a whole cycle in either direction.
    expect(resolveEffort("autonomous", "autonomous-gate")).toBe("high");
  });

  it("uses medium as the default tier for bounded work", () => {
    setConfig({});
    // The TODO the executor consumes already says what to build, so the work is
    // bounded implementation rather than open-ended investigation.
    expect(resolveEffort("execute", "execute")).toBe("medium");
    expect(resolveEffort("autonomous", "execute")).toBe("medium");
    // Checks an enumerated Acceptance Criteria list — a checklist, not a hunt.
    expect(resolveEffort("review", "verify-readme")).toBe("medium");
    // Applies a requested edit to one document; explicitly must not touch code.
    expect(resolveEffort("update-readme", "update-readme")).toBe("medium");
    expect(resolveEffort("review", "plan-todo-from-review")).toBe("medium");
    expect(resolveEffort("init", "review-todos")).toBe("medium");
    expect(resolveEffort("update-todo", "update-todo")).toBe("medium");
    // Invents the candidate work items rather than reading them off an input.
    expect(resolveEffort("execute", "suggest-workspace")).toBe("medium");
  });

  it("uses opus/low for work a step above mechanical", () => {
    setConfig({});
    // Reads version-pinning files and task runners, then resolves *which*
    // package manager and activation command apply — shallow judgment, but
    // judgment, so it is not the sonnet rung.
    expect(resolveEffort("review", "discover-constraints")).toBe("low");
    expect(resolveModel("review", "discover-constraints")).toBe("opus");
    // Fills a PR template from the diff and README, plus the gh mechanics.
    expect(resolveEffort("create-pr", "create-pr")).toBe("low");
    expect(resolveModel("create-pr", "create-pr")).toBe("opus");
    // A single yes/no against documented criteria, biased toward proceeding.
    expect(resolveEffort("autonomous", "readme-clarity-gate")).toBe("low");
    expect(resolveModel("autonomous", "readme-clarity-gate")).toBe("opus");
    // Pick the best of N markdown candidates, then splice them — no code.
    expect(resolveEffort("init", "best-of-n-file-reviewer")).toBe("low");
    expect(resolveModel("init", "best-of-n-file-reviewer")).toBe("opus");
    expect(resolveEffort("execute", "best-of-n-synthesizer")).toBe("low");
    expect(resolveModel("execute", "best-of-n-synthesizer")).toBe("opus");
  });

  it("uses sonnet/low only where there is nothing to think about", () => {
    setConfig({});
    for (const step of ["collect-reviews", "verify-todo", "deep-search", "aggregate-suggestions", "prune-suggestions"] as const) {
      expect(resolveEffort("review", step)).toBe("low");
      expect(resolveModel("review", step)).toBe("sonnet");
    }
  });

  it("uses exactly four rungs of one model+effort ladder", () => {
    // The two tables are not tuned independently — together they form a single
    // ordered ladder, cheapest first:
    //   sonnet/low  → purely mechanical work
    //   opus/low    → a bit harder than mechanical
    //   opus/medium → the default
    //   opus/high   → needs real thought
    // Any other pairing is a tier that has to justify itself, and the two that
    // tempt you are both bad deals: sonnet/high pays extra to make the weaker
    // model think hard, and sonnet/medium is a rung this ladder deliberately
    // does not have — work above "mechanical" goes to opus instead.
    const rungs = new Set(
      Object.values(STEP_TYPES).map(
        (step) => `${STEP_DEFAULT_MODELS[step]}/${STEP_DEFAULT_EFFORTS[step]}`,
      ),
    );
    expect([...rungs].sort()).toEqual([
      "opus/high",
      "opus/low",
      "opus/medium",
      "sonnet/low",
    ]);
  });

  it("never declares xhigh or max as a code-level default", () => {
    const levels = Object.values(STEP_DEFAULT_EFFORTS);
    expect(levels).not.toContain("xhigh");
    expect(levels).not.toContain("max");
  });

  it("lets config.yml override a code-level step default", () => {
    setConfig({
      operations: {
        execute: {
          steps: {
            execute: { effort: "xhigh" },
          },
        },
      },
    });
    expect(resolveEffort("execute", "execute")).toBe("xhigh");
    // Unconfigured operation types keep the code-level default
    expect(resolveEffort("autonomous", "execute")).toBe("medium");
  });

  it("prefers a configured operation-type effort over the code-level step default", () => {
    setConfig({ operations: { review: { effort: "max" } } });
    expect(resolveEffort("review", "collect-reviews")).toBe("max");
  });

  it("declares a model and an effort for exactly the same step types", () => {
    // A step with one but not the other is a drift bug: it means a tier was
    // added to one table and forgotten in the other.
    expect(Object.keys(STEP_DEFAULT_EFFORTS).sort()).toEqual(
      Object.keys(STEP_DEFAULT_MODELS).sort(),
    );
  });

  it("covers every known step type, so a new one must pick a tier", () => {
    const known = Object.values(STEP_TYPES).sort();
    expect(Object.keys(STEP_DEFAULT_MODELS).sort()).toEqual(known);
    expect(Object.keys(STEP_DEFAULT_EFFORTS).sort()).toEqual(known);
  });
});
