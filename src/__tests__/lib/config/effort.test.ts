import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveEffort, resolveModel, STEP_DEFAULT_EFFORTS, STEP_DEFAULT_MODELS } from "@/lib/config/model";
import { _resetConfig, _setConfigFilePath } from "@/lib/config/resolver";
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

  it("resolves a code-level step default when nothing is configured", () => {
    setConfig({});
    expect(resolveEffort("execute", "execute")).toBe("medium");
    expect(resolveModel("execute", "execute")).toBe("opus");
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
