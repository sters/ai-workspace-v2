import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveEffort, STEP_DEFAULT_EFFORTS } from "@/lib/config/model";
import { _resetConfig, _setConfigFilePath } from "@/lib/config/resolver";
import { CLAUDE_EFFORTS } from "@/types/claude";
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

  it("returns undefined when nothing is configured and the step has no default", () => {
    setConfig({});
    expect(resolveEffort("execute")).toBeUndefined();
    expect(resolveEffort("review", "code-review")).toBeUndefined();
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

  it("uses xhigh as the code-level default for the execute step", () => {
    setConfig({});
    expect(resolveEffort("execute", "execute")).toBe("xhigh");
    expect(resolveEffort("autonomous", "execute")).toBe("xhigh");
  });

  it("uses low as the code-level default for cheap mechanical steps", () => {
    setConfig({});
    expect(resolveEffort("review", "collect-reviews")).toBe("low");
    expect(resolveEffort("review", "verify-todo")).toBe("low");
    expect(resolveEffort("search", "deep-search")).toBe("low");
    expect(resolveEffort("execute", "aggregate-suggestions")).toBe("low");
  });

  it("uses medium as the code-level default for procedural steps", () => {
    setConfig({});
    expect(resolveEffort("create-pr", "create-pr")).toBe("medium");
    expect(resolveEffort("execute", "best-of-n-reviewer")).toBe("medium");
    expect(resolveEffort("autonomous", "readme-clarity-gate")).toBe("medium");
    expect(resolveEffort("execute", "suggest-workspace")).toBe("medium");
  });

  it("leaves decision-critical steps on the CLI default", () => {
    setConfig({});
    // The autonomous gate controls the loop — no code-level downgrade.
    expect(resolveEffort("autonomous", "autonomous-gate")).toBeUndefined();
    expect(resolveEffort("review", "code-review")).toBeUndefined();
  });

  it("lets config.yml override a code-level step default", () => {
    setConfig({
      operations: {
        execute: {
          steps: {
            execute: { effort: "medium" },
          },
        },
      },
    });
    expect(resolveEffort("execute", "execute")).toBe("medium");
    // Unconfigured operation types keep the code-level default
    expect(resolveEffort("autonomous", "execute")).toBe("xhigh");
  });

  it("prefers a configured operation-type effort over the code-level step default", () => {
    setConfig({ operations: { review: { effort: "max" } } });
    expect(resolveEffort("review", "collect-reviews")).toBe("max");
  });

  it("only declares efforts that deviate from the CLI default", () => {
    expect(Object.values(STEP_DEFAULT_EFFORTS)).not.toContain("high");
  });
});
