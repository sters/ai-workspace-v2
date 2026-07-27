import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveEffort, STEP_DEFAULT_EFFORTS, STEP_DEFAULT_MODELS } from "@/lib/config/model";
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

  it("uses high for open-ended steps and decisions the pipeline enforces", () => {
    setConfig({});
    expect(resolveEffort("execute", "execute")).toBe("high");
    expect(resolveEffort("autonomous", "execute")).toBe("high");
    expect(resolveEffort("init", "analyze-readme")).toBe("high");
    expect(resolveEffort("init", "plan-todo")).toBe("high");
    expect(resolveEffort("review", "code-review")).toBe("high");
    expect(resolveEffort("review", "verify-readme")).toBe("high");
    expect(resolveEffort("init", "coordinate-todos")).toBe("high");
    expect(resolveEffort("autonomous", "autonomous-gate")).toBe("high");
    expect(resolveEffort("execute", "research")).toBe("high");
    expect(resolveEffort("update-readme", "update-readme")).toBe("high");
    // Decides AND merges implementations across candidate worktrees.
    expect(resolveEffort("execute", "best-of-n-reviewer")).toBe("high");
  });

  it("uses medium for bounded translation and checklist steps", () => {
    setConfig({});
    expect(resolveEffort("create-pr", "create-pr")).toBe("medium");
    expect(resolveEffort("init", "best-of-n-file-reviewer")).toBe("medium");
    expect(resolveEffort("autonomous", "readme-clarity-gate")).toBe("medium");
    expect(resolveEffort("execute", "suggest-workspace")).toBe("medium");
    expect(resolveEffort("execute", "prune-suggestions")).toBe("medium");
    expect(resolveEffort("review", "plan-todo-from-review")).toBe("medium");
    expect(resolveEffort("review", "discover-constraints")).toBe("medium");
    expect(resolveEffort("init", "review-todos")).toBe("medium");
    expect(resolveEffort("update-todo", "update-todo")).toBe("medium");
    expect(resolveEffort("execute", "best-of-n-synthesizer")).toBe("medium");
  });

  it("uses low for extraction and aggregation over already-structured text", () => {
    setConfig({});
    expect(resolveEffort("review", "collect-reviews")).toBe("low");
    expect(resolveEffort("review", "verify-todo")).toBe("low");
    expect(resolveEffort("search", "deep-search")).toBe("low");
    expect(resolveEffort("execute", "aggregate-suggestions")).toBe("low");
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
    expect(resolveEffort("autonomous", "execute")).toBe("high");
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
