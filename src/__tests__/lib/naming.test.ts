// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dateStamp, deriveBranchName, workspaceDirName } from "@/lib/naming";

describe("dateStamp", () => {
  it("is the YYYYMMDD form the directory and branch names carry", () => {
    expect(dateStamp(new Date("2026-09-11T15:00:00Z"))).toBe("20260911");
  });
});

describe("workspaceDirName", () => {
  it("slugs the name between the task type and the date", () => {
    expect(workspaceDirName({ taskType: "bugfix", name: "Login Crash", dateStamp: "20260911" }))
      .toBe("bugfix-login-crash-20260911");
  });

  it("falls back to `workspace` when nothing in the name is ASCII", () => {
    expect(workspaceDirName({ taskType: "bugfix", name: "ログイン時のクラッシュ", dateStamp: "20260911" }))
      .toBe("bugfix-workspace-20260911");
  });

  it("gives a ticket id its own segment instead of repeating it in the slug", () => {
    expect(
      workspaceDirName({
        taskType: "feature",
        name: "PROJ-1 add retry",
        ticketId: "PROJ-1",
        dateStamp: "20260911",
      }),
    ).toBe("feature-PROJ-1-add-retry-20260911");
  });

  it("keeps a slug that is nothing but the ticket id from emptying the name", () => {
    expect(
      workspaceDirName({ taskType: "feature", name: "PROJ-1", ticketId: "PROJ-1", dateStamp: "20260911" }),
    ).toBe("feature-PROJ-1-workspace-20260911");
  });
});

describe("deriveBranchName", () => {
  it("turns the workspace name into <type>/<slug>-<date>", () => {
    expect(deriveBranchName("bugfix-login-crash-20260911", "", "20260101"))
      .toBe("bugfix/login-crash-20260911");
  });

  it("suffixes the alias instead of the date for an aliased worktree", () => {
    expect(deriveBranchName("feature-ABC-1-thing-20260101", "dev", "20260101"))
      .toBe("feature/ABC-1-thing-dev");
  });

  it("lifts a ticket id out of the workspace name and drops the date", () => {
    expect(deriveBranchName("feature-PROJ1-add-retry-20260911", "", "20260101"))
      .toBe("feature/PROJ1-add-retry");
  });

  it("uses the fallback date when the workspace name carries none", () => {
    // What a collision suffix produces: `…-20260911-2` no longer ends in a date.
    expect(deriveBranchName("bugfix-login-crash-20260911-2", "", "20260101"))
      .toBe("bugfix/login-crash-20260911-2-20260101");
  });
});
