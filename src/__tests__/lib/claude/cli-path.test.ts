import { vi, describe, it, expect, beforeEach } from "vitest";

const mockExecSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, execSync: mockExecSync },
    execSync: mockExecSync,
  };
});

// Import after mock setup
const { getCliPath, _resetCliPath } = await import("@/lib/claude/cli-path");

describe("getCliPath", () => {
  beforeEach(() => {
    _resetCliPath();
    mockExecSync.mockReset();
  });

  it("resolves via which + realpath", () => {
    mockExecSync
      .mockReturnValueOnce("/usr/local/bin/claude\n")
      .mockReturnValueOnce("/usr/local/lib/claude/cli.js\n");

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it("falls back to readlink -f when realpath fails", () => {
    mockExecSync
      .mockReturnValueOnce("/usr/local/bin/claude\n")
      .mockImplementationOnce(() => { throw new Error("realpath failed"); })
      .mockReturnValueOnce("/usr/local/lib/claude/cli.js\n");

    expect(getCliPath()).toBe("/usr/local/lib/claude/cli.js");
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it("falls back to raw bin path when both realpath and readlink fail", () => {
    mockExecSync
      .mockReturnValueOnce("/usr/local/bin/claude\n")
      .mockImplementationOnce(() => { throw new Error("realpath failed"); })
      .mockImplementationOnce(() => { throw new Error("readlink failed"); });

    expect(getCliPath()).toBe("/usr/local/bin/claude");
  });

  it("returns 'claude' when which fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not found"); });

    expect(getCliPath()).toBe("claude");
  });

  it("caches the result (lazy evaluation)", () => {
    mockExecSync
      .mockReturnValueOnce("/usr/local/bin/claude\n")
      .mockReturnValueOnce("/usr/local/lib/claude/cli.js\n");

    const first = getCliPath();
    const second = getCliPath();
    expect(first).toBe(second);
    // execSync should only be called on first invocation
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it("re-resolves after _resetCliPath()", () => {
    mockExecSync.mockReturnValue("/usr/local/bin/claude\n");

    getCliPath();
    _resetCliPath();
    getCliPath();

    // Called for both resolutions
    expect(mockExecSync.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
