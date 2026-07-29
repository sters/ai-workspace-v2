import { vi, describe, it, expect, beforeEach } from "vitest";

const execConstraintCommand = vi.fn();

vi.mock("@/lib/workspace/constraint-runner", () => ({
  execConstraintCommand: (...args: unknown[]) => execConstraintCommand(...args),
}));

import {
  selectPrewarmCommands,
  startToolchainPrewarm,
  awaitToolchainPrewarm,
  _resetToolchainPrewarm,
} from "@/lib/workspace/toolchain-prewarm";

const repos = [{ repoName: "repo", worktreePath: "/wt/repo" }];

function constraints(entries: [string, string][]) {
  return [
    {
      repoName: "repo",
      constraints: entries.map(([label, command]) => ({ label, command })),
    },
  ];
}

beforeEach(() => {
  _resetToolchainPrewarm();
  execConstraintCommand.mockReset();
  execConstraintCommand.mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 5,
  });
});

describe("selectPrewarmCommands", () => {
  it("picks environment setup labels, case-insensitively", () => {
    const picked = selectPrewarmCommands([
      { label: "Toolchain", command: "mise install" },
      { label: "install", command: "pnpm install" },
      { label: "Submodules", command: "git submodule update --init" },
      { label: "Lint", command: "pnpm lint" },
    ]);
    expect(picked.map((c) => c.command)).toEqual([
      "mise install",
      "pnpm install",
      "git submodule update --init",
    ]);
  });

  it("excludes commands that write into the worktree", () => {
    // The planner and plan reviewer read the tree while prewarm runs, and any
    // diff appearing under them belongs to the executor.
    const picked = selectPrewarmCommands([
      { label: "Codegen", command: "pnpm codegen" },
      { label: "Format", command: "pnpm format" },
      { label: "MSW", command: "pnpm msw:init" },
    ]);
    expect(picked).toEqual([]);
  });
});

describe("startToolchainPrewarm", () => {
  it("runs a repo's prep commands in declared order", async () => {
    const started = startToolchainPrewarm({
      workspace: "ws",
      repos,
      constraints: constraints([
        ["Toolchain", "mise install"],
        ["Install", "pnpm install"],
        ["Lint", "pnpm lint"],
      ]),
    });

    expect(started).toEqual([
      { repoName: "repo", commands: ["mise install", "pnpm install"] },
    ]);

    const [result] = await awaitToolchainPrewarm("ws", ["repo"]);
    expect(result.ok).toBe(true);
    expect(execConstraintCommand.mock.calls.map((c) => c[0])).toEqual([
      "mise install",
      "pnpm install",
    ]);
    expect(execConstraintCommand.mock.calls[0][1]).toMatchObject({ cwd: "/wt/repo" });
  });

  it("skips a repo with no prep commands declared", async () => {
    const started = startToolchainPrewarm({
      workspace: "ws",
      repos,
      constraints: constraints([["Lint", "pnpm lint"]]),
    });
    expect(started).toEqual([]);
    expect(await awaitToolchainPrewarm("ws", ["repo"])).toEqual([]);
    expect(execConstraintCommand).not.toHaveBeenCalled();
  });

  it("does not restart a repo that is already prewarming", () => {
    const args = {
      workspace: "ws",
      repos,
      constraints: constraints([["Install", "pnpm install"]]),
    };
    startToolchainPrewarm(args);
    expect(startToolchainPrewarm(args)).toEqual([]);
    expect(execConstraintCommand).toHaveBeenCalledTimes(1);
  });

  it("stops after a failing step and reports it without throwing", async () => {
    execConstraintCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false, durationMs: 3 })
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 3 });

    startToolchainPrewarm({
      workspace: "ws",
      repos,
      constraints: constraints([
        ["Toolchain", "mise install"],
        ["Install", "pnpm install"],
      ]),
    });

    const [result] = await awaitToolchainPrewarm("ws", ["repo"]);
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    // Install depends on the toolchain, so running it after a failed activation
    // only produces a second confusing failure.
    expect(execConstraintCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a step that throws as failed rather than rejecting", async () => {
    execConstraintCommand.mockRejectedValue(new Error("spawn failed"));
    startToolchainPrewarm({
      workspace: "ws",
      repos,
      constraints: constraints([["Install", "pnpm install"]]),
    });
    const [result] = await awaitToolchainPrewarm("ws", ["repo"]);
    expect(result.ok).toBe(false);
    expect(result.steps[0].exitCode).toBeNull();
  });
});

describe("awaitToolchainPrewarm", () => {
  it("returns nothing when prewarm never ran for the workspace", async () => {
    expect(await awaitToolchainPrewarm("other-ws", ["repo"])).toEqual([]);
  });

  it("resolves instantly on a second await and never re-runs", async () => {
    startToolchainPrewarm({
      workspace: "ws",
      repos,
      constraints: constraints([["Install", "pnpm install"]]),
    });
    await awaitToolchainPrewarm("ws", ["repo"]);
    await awaitToolchainPrewarm("ws", ["repo"]);
    expect(execConstraintCommand).toHaveBeenCalledTimes(1);
  });
});
