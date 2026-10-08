import { describe, it, expect } from "vitest";
import { runProcess } from "@/lib/process/run";

describe("runProcess", () => {
  it("lets timers run while the child is still running", async () => {
    let timerFiredFirst = false;
    let exited = false;
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        timerFiredFirst = !exited;
        resolve();
      }, 20),
    );
    const run = runProcess(["sleep", "0.3"]).then((r) => {
      exited = true;
      return r;
    });
    await Promise.all([timer, run]);
    expect(timerFiredFirst).toBe(true);
  });

  it("reports a non-zero exit with its stderr instead of throwing", async () => {
    const result = await runProcess(["sh", "-c", "echo out; echo err >&2; exit 3"]);
    expect(result).toEqual({ exitCode: 3, success: false, stdout: "out\n", stderr: "err\n" });
  });

  it("feeds stdin and closes it", async () => {
    const result = await runProcess(["cat"], { stdin: "hello" });
    expect(result.stdout).toBe("hello");
  });

  it("drains output larger than a pipe buffer", async () => {
    const result = await runProcess(["sh", "-c", "head -c 300000 /dev/zero | tr '\\0' a; head -c 300000 /dev/zero | tr '\\0' b >&2"]);
    expect(result.stdout.length).toBe(300000);
    expect(result.stderr.length).toBe(300000);
  });

  it("kills a child that outlives its timeout", async () => {
    const started = Date.now();
    const result = await runProcess(["sleep", "5"], { timeoutMs: 50 });
    expect(result.success).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("runs in the given cwd", async () => {
    const result = await runProcess(["pwd"], { cwd: "/" });
    expect(result.stdout.trim()).toBe("/");
  });
});
