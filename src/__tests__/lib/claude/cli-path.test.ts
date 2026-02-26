import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

const mockWhich = vi.fn();
const mockSpawnSync = vi.fn();

// Store original Bun methods
const originalWhich = Bun.which;
const originalSpawnSync = Bun.spawnSync;

// Override Bun globals before importing the module
Bun.which = mockWhich as typeof Bun.which;
Bun.spawnSync = mockSpawnSync as typeof Bun.spawnSync;

const { getCliPath, _resetCliPath } = await import("@/lib/claude/cli-path");

describe("getCliPath", () => {
  beforeEach(() => {
    _resetCliPath();
    mockWhich.mockReset();
    mockSpawnSync.mockReset();
  });

  afterAll(() => {
    // Restore original Bun methods
    Bun.which = originalWhich;
    Bun.spawnSync = originalSpawnSync;
  });

  it("resolves via Bun.which + realpath", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValueOnce({
      success: true,
      stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
      stderr: Buffer.from(""),
    });

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockWhich).toHaveBeenCalledWith("claude");
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to readlink -f when realpath fails", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("realpath failed"),
      })
      .mockReturnValueOnce({
        success: true,
        stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
        stderr: Buffer.from(""),
      });

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  it("falls back to raw bin path when both realpath and readlink fail", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("realpath failed"),
      })
      .mockReturnValueOnce({
        success: false,
        stdout: Buffer.from(""),
        stderr: Buffer.from("readlink failed"),
      });

    expect(getCliPath()).toBe("/usr/local/bin/claude");
  });

  it("returns 'claude' when Bun.which returns null", () => {
    mockWhich.mockReturnValue(null);

    expect(getCliPath()).toBe("claude");
  });

  it("caches the result (lazy evaluation)", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValueOnce({
      success: true,
      stdout: Buffer.from("/usr/local/lib/claude/cli.js\n"),
      stderr: Buffer.from(""),
    });

    const first = getCliPath();
    const second = getCliPath();
    expect(first).toBe(second);
    // Bun.which should only be called on first invocation
    expect(mockWhich).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after _resetCliPath()", () => {
    mockWhich.mockReturnValue("/usr/local/bin/claude");
    mockSpawnSync.mockReturnValue({
      success: true,
      stdout: Buffer.from("/usr/local/bin/claude\n"),
      stderr: Buffer.from(""),
    });

    getCliPath();
    _resetCliPath();
    getCliPath();

    // Called for both resolutions
    expect(mockWhich).toHaveBeenCalledTimes(2);
  });
});
