import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mergeConfig,
  getOperationConfig,
  normalizeRawConfig,
  _resetConfig,
  _setConfigFilePath,
} from "@/lib/config/resolver";
import { CONFIG_DEFAULTS } from "@/lib/config/defaults";
import type { AppConfig } from "@/types/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";

function writeTempConfig(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-test-"));
  const filePath = path.join(dir, "config.yml");
  fs.writeFileSync(filePath, stringify(config), "utf-8");
  return filePath;
}

// mergeConfig picks env > file > default through one shared helper for every
// scalar field, and app-config.test.ts covers that chain. What is left here is
// the behaviour that helper does *not* give you for free.
describe("mergeConfig", () => {
  // `pick` tests `!== undefined`, so an explicit null is a value, not an absence.
  it("file config can null out chat.model", () => {
    const result = mergeConfig(
      CONFIG_DEFAULTS,
      { chat: { model: null } } as Partial<AppConfig>,
      {},
    );
    expect(result.chat.model).toBeNull();
  });

  it("merges steps in typeOverrides", () => {
    const result = mergeConfig(
      CONFIG_DEFAULTS,
      {
        operations: {
          typeOverrides: {
            review: {
              model: "sonnet",
              steps: { "code-review": { model: "opus" } },
            },
          },
        },
      } as Partial<AppConfig>,
      {},
    );
    expect(result.operations.typeOverrides.review?.model).toBe("sonnet");
    expect(result.operations.typeOverrides.review?.steps?.["code-review"]?.model).toBe("opus");
  });
});

describe("getOperationConfig", () => {
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

  it("returns model and steps from type override", () => {
    tmpConfigPath = writeTempConfig({
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
    _setConfigFilePath(tmpConfigPath);
    _resetConfig();

    const cfg = getOperationConfig("review");
    expect(cfg.model).toBe("sonnet");
    expect(cfg.steps?.["code-review"]?.model).toBe("opus");
  });

  it("falls back to global model when no type override model", () => {
    tmpConfigPath = writeTempConfig({
      operations: {
        model: "haiku",
      },
    });
    _setConfigFilePath(tmpConfigPath);
    _resetConfig();

    const cfg = getOperationConfig("execute");
    expect(cfg.model).toBe("haiku");
    expect(cfg.steps).toBeUndefined();
  });
});

describe("normalizeRawConfig", () => {
  it("moves steps into typeOverrides", () => {
    const raw = {
      operations: {
        model: "sonnet",
        review: {
          model: "haiku",
          steps: {
            "code-review": { model: "opus" },
          },
        },
      },
    };
    const result = normalizeRawConfig(raw);
    expect(result.operations?.typeOverrides?.review?.model).toBe("haiku");
    expect(result.operations?.typeOverrides?.review?.steps?.["code-review"]?.model).toBe("opus");
  });
});
