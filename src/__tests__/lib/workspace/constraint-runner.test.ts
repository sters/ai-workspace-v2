import { describe, expect, it } from "vitest";
import { execConstraintCommand, buildConstraintReport } from "@/lib/workspace/constraint-runner";
import type { ConstraintExecResult } from "@/lib/workspace/constraint-runner";

describe("execConstraintCommand", () => {
  it("returns exitCode 0 and stdout for a successful command", async () => {
    const result = await execConstraintCommand("echo hello", {
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns non-zero exit code for a failing command", async () => {
    const result = await execConstraintCommand("exit 1", {
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr separately", async () => {
    const result = await execConstraintCommand("echo err >&2", {
      cwd: "/tmp",
    });
    expect(result.stderr).toBe("err");
  });

  it("truncates long output", async () => {
    // Generate output longer than maxChars
    const result = await execConstraintCommand(
      "python3 -c \"print('x' * 200)\"",
      { cwd: "/tmp", maxChars: 50 },
    );
    expect(result.stdout.length).toBeLessThanOrEqual(100); // 50 + truncation message
    expect(result.stdout).toContain("(truncated");
  });

  it("times out and kills long-running process", async () => {
    const result = await execConstraintCommand("sleep 60", {
      cwd: "/tmp",
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(5000);
  });

  it("returns exit code 127 for command not found", async () => {
    const result = await execConstraintCommand("nonexistent_command_xyz_12345", {
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(127);
  });
});

describe("buildConstraintReport", () => {
  it("generates a report with all PASS results", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Lint",
        command: "make lint",
        exitCode: 0,
        passed: true,
        stdout: "All checks passed",
        stderr: "",
        timedOut: false,
        durationMs: 1200,
        status: "PASS",
      },
      {
        label: "Test",
        command: "make test",
        exitCode: 0,
        passed: true,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        durationMs: 3000,
        status: "PASS",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("# Constraint Verification: my-repo");
    expect(report).toContain("ALL PASSED");
    expect(report).toContain("2/2");
    expect(report).toContain("## Lint: PASS");
    expect(report).toContain("## Test: PASS");
    expect(report).toContain("`make lint`");
  });

  it("generates a report with FAIL results", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Lint",
        command: "make lint",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "lint error on line 42",
        timedOut: false,
        durationMs: 500,
        status: "FAIL",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("FAILURES DETECTED");
    expect(report).toContain("0/1");
    expect(report).toContain("## Lint: FAIL");
    expect(report).toContain("lint error on line 42");
  });

  it("generates a report with SKIPPED status", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Lint",
        command: "golangci-lint run",
        exitCode: 127,
        passed: false,
        stdout: "",
        stderr: "command not found",
        timedOut: false,
        durationMs: 10,
        status: "SKIPPED",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("## Lint: SKIPPED");
  });

  it("generates a report with PRE-EXISTING status", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Test",
        command: "make test",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "test failed",
        timedOut: false,
        durationMs: 2000,
        status: "PRE-EXISTING",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("## Test: PRE-EXISTING");
  });

  it("generates a report with TIMEOUT status", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Test",
        command: "make test",
        exitCode: null,
        passed: false,
        stdout: "",
        stderr: "",
        timedOut: true,
        durationMs: 300000,
        status: "FAIL",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("## Test: TIMEOUT");
    expect(report).toContain("N/A (timed out)");
  });

  it("counts only PASS results for the summary", () => {
    const results: ConstraintExecResult[] = [
      {
        label: "Lint", command: "make lint", exitCode: 0, passed: true,
        stdout: "", stderr: "", timedOut: false, durationMs: 100, status: "PASS",
      },
      {
        label: "Test", command: "make test", exitCode: 1, passed: false,
        stdout: "", stderr: "", timedOut: false, durationMs: 100, status: "FAIL",
      },
      {
        label: "Build", command: "make build", exitCode: 127, passed: false,
        stdout: "", stderr: "", timedOut: false, durationMs: 100, status: "SKIPPED",
      },
    ];

    const report = buildConstraintReport("my-repo", results);
    expect(report).toContain("1/3");
    expect(report).toContain("FAILURES DETECTED");
  });
});
