import { describe, expect, it, vi } from "vitest";
import { describeChildExit, reraiseSignal, signalExitCode } from "@/lib/process/child-exit";

describe("describeChildExit", () => {
  it("reports a clean exit", () => {
    expect(describeChildExit({ name: "next-server", exitCode: 0, signalCode: null })).toBe(
      "next-server exited with code 0",
    );
  });

  it("reports a non-zero exit", () => {
    expect(describeChildExit({ name: "next dev", exitCode: 1, signalCode: null })).toBe(
      "next dev exited with code 1",
    );
  });

  it("names the signal when we asked the child to stop", () => {
    expect(
      describeChildExit({
        name: "chat-server",
        exitCode: null,
        signalCode: "SIGTERM",
        requested: true,
      }),
    ).toBe("chat-server was killed by SIGTERM (shutdown requested by us)");
  });

  it("flags a SIGKILL nobody asked for as an external kill, and names memory pressure", () => {
    const msg = describeChildExit({
      name: "next dev",
      exitCode: null,
      signalCode: "SIGKILL",
    });
    expect(msg).toContain("next dev was killed by SIGKILL");
    expect(msg).toContain("not requested by us");
    expect(msg).toContain("memory pressure");
  });

  it("points an unrequested SIGTERM at name-based killers", () => {
    const msg = describeChildExit({ name: "next dev", exitCode: null, signalCode: "SIGTERM" });
    expect(msg).toContain("not requested by us");
    expect(msg).toContain("pkill -f");
  });

  it("flags other unrequested signals as external without the memory hint", () => {
    const msg = describeChildExit({
      name: "chat-server",
      exitCode: null,
      signalCode: "SIGHUP",
    });
    expect(msg).toContain("chat-server was killed by SIGHUP");
    expect(msg).toContain("not requested by us");
    expect(msg).not.toContain("memory pressure");
  });

  it("prefers the signal over an exit code when both are reported", () => {
    expect(
      describeChildExit({ name: "next dev", exitCode: 0, signalCode: "SIGKILL" }),
    ).toContain("killed by SIGKILL");
  });

  it("says so plainly when neither an exit code nor a signal is reported", () => {
    expect(describeChildExit({ name: "slack-server", exitCode: null, signalCode: null })).toBe(
      "slack-server exited (no exit code or signal reported)",
    );
  });
});

describe("reraiseSignal", () => {
  it("drops our own handler before signalling, so the default disposition applies", () => {
    const calls: string[] = [];
    reraiseSignal("SIGTERM", {
      pid: 4242,
      removeAllListeners: (event) => calls.push(`remove:${event}`),
      kill: (pid, signal) => calls.push(`kill:${pid}:${signal}`),
    });
    expect(calls).toEqual(["remove:SIGTERM", "kill:4242:SIGTERM"]);
  });

  it("reports failure instead of throwing, so the caller can still exit", () => {
    const kill = vi.fn(() => {
      throw new Error("EPERM");
    });
    expect(
      reraiseSignal("SIGTERM", { pid: 1, removeAllListeners: () => {}, kill }),
    ).toBe(false);
    expect(kill).toHaveBeenCalled();
  });
});

describe("signalExitCode", () => {
  it("follows the 128 + signal number convention", () => {
    expect(signalExitCode("SIGTERM")).toBe(143);
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGHUP")).toBe(129);
  });

  it("stays non-zero for a signal it does not know", () => {
    expect(signalExitCode("SIGUSR2")).toBe(128);
  });
});
