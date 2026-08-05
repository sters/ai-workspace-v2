import { describe, expect, it } from "vitest";
import { describeChildExit } from "@/lib/process/child-exit";

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
