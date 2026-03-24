import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveModel } from "@/lib/config/model";
import { _resetConfig, _setConfigFilePath } from "@/lib/config/resolver";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";

function writeTempConfig(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-test-"));
  const filePath = path.join(dir, "config.yml");
  fs.writeFileSync(filePath, stringify(config), "utf-8");
  return filePath;
}

describe("resolveModel", () => {
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

  it("returns undefined when no model is configured", () => {
    setConfig({});
    expect(resolveModel("execute")).toBeUndefined();
  });

  it("returns explicitModel when provided (highest priority)", () => {
    setConfig({
      operations: { model: "sonnet" },
    });
    expect(resolveModel("execute", undefined, "opus")).toBe("opus");
  });

  it("returns global operations.model", () => {
    setConfig({
      operations: { model: "sonnet" },
    });
    expect(resolveModel("execute")).toBe("sonnet");
  });

  it("returns operation type model over global", () => {
    setConfig({
      operations: {
        model: "sonnet",
        execute: { model: "opus" },
      },
    });
    expect(resolveModel("execute")).toBe("opus");
    // Other operation types still fall back to global
    expect(resolveModel("review")).toBe("sonnet");
  });

  it("returns step model over operation type model", () => {
    setConfig({
      operations: {
        model: "haiku",
        review: {
          model: "sonnet",
          steps: {
            "code-review": { model: "opus" },
          },
        },
      },
    });
    expect(resolveModel("review", "code-review")).toBe("opus");
    // Other steps fall back to operation type model
    expect(resolveModel("review", "verify-todo")).toBe("sonnet");
    // No step specified falls back to operation type model
    expect(resolveModel("review")).toBe("sonnet");
  });

  it("returns explicitModel over step model (highest priority)", () => {
    setConfig({
      operations: {
        review: {
          model: "sonnet",
          steps: {
            "code-review": { model: "opus" },
          },
        },
      },
    });
    expect(resolveModel("review", "code-review", "haiku")).toBe("haiku");
  });

  it("falls back correctly for unknown stepType", () => {
    setConfig({
      operations: {
        review: {
          model: "sonnet",
          steps: {
            "code-review": { model: "opus" },
          },
        },
      },
    });
    // Unknown step falls back to operation type model
    expect(resolveModel("review", "collect-reviews")).toBe("sonnet");
  });

  it("falls back to global when operation type has no model", () => {
    setConfig({
      operations: {
        model: "haiku",
        review: {
          steps: {
            "code-review": { model: "opus" },
          },
        },
      },
    });
    // Step with explicit model
    expect(resolveModel("review", "code-review")).toBe("opus");
    // No step or step without model falls back to global
    expect(resolveModel("review")).toBe("haiku");
    expect(resolveModel("review", "verify-todo")).toBe("haiku");
  });
});
