import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { getMaxGroupConcurrency } from "@/lib/pipeline/constants";
import { CONFIG_DEFAULTS } from "@/lib/config/defaults";
import { _resetConfig, _setConfigFilePath } from "@/lib/config/resolver";

function writeTempConfig(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-concurrency-"));
  const filePath = path.join(dir, "config.yml");
  fs.writeFileSync(filePath, stringify(config), "utf-8");
  return filePath;
}

describe("group concurrency", () => {
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

  it("defaults to a limit that covers a two-repo review fan-out", () => {
    // review.ts emits `2..3 children per repo + 1 cross-repo`, so two repos with
    // TODO files is 7. A default below that queues part of every multi-repo
    // review behind the rest.
    setConfig({});
    expect(getMaxGroupConcurrency()).toBeGreaterThanOrEqual(7);
    expect(CONFIG_DEFAULTS.operations.maxGroupConcurrency).toBe(
      getMaxGroupConcurrency(),
    );
  });

  it("reads operations.maxGroupConcurrency from config.yml", () => {
    setConfig({ operations: { maxGroupConcurrency: 3 } });
    expect(getMaxGroupConcurrency()).toBe(3);
  });

  it("is read at call time, not captured at module load", () => {
    // Both call sites build a Semaphore per group, so a config change has to be
    // visible to the next group without a restart.
    setConfig({ operations: { maxGroupConcurrency: 2 } });
    expect(getMaxGroupConcurrency()).toBe(2);
    setConfig({ operations: { maxGroupConcurrency: 9 } });
    expect(getMaxGroupConcurrency()).toBe(9);
  });

  it("never returns a value a Semaphore would reject", () => {
    // `new Semaphore(n)` throws for n < 1, and that would fail the whole phase
    // rather than degrade, so a nonsensical config must be clamped.
    setConfig({ operations: { maxGroupConcurrency: 0 } });
    expect(getMaxGroupConcurrency()).toBeGreaterThanOrEqual(1);
    setConfig({ operations: { maxGroupConcurrency: -4 } });
    expect(getMaxGroupConcurrency()).toBeGreaterThanOrEqual(1);
  });
});
