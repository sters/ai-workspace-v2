import { describe, expect, it } from "vitest";
import { agreement, verdictsFor } from "@/lib/bench/compare";

describe("agreement", () => {
  it("matches reworded items to the reference and counts how many reach the same verdict", () => {
    const ref = [
      { key: "requirement: Endpoint returns 404 for unknown ids", value: "SATISFIED" },
      { key: "requirement: Docs updated under docs/api", value: "UNSATISFIED" },
      { key: "requirement: Staging sign-off", value: "PENDING-HUMAN" },
    ];
    const other = [
      { key: "requirement: the endpoint returns a 404 for unknown ids", value: "SATISFIED" },
      { key: "requirement: docs updated under docs/api", value: "PARTIAL" },
      { key: "requirement: A requirement the reference never listed", value: "SATISFIED" },
    ];

    expect(agreement(ref, other)).toEqual({ same: 1, total: 3, differs: 1, missing: 1, extra: 1 });
  });

  it("pairs each item at most once, so a duplicate cannot claim two reference items", () => {
    const ref = [{ key: "todo: add the handler", value: "VERIFIED" }, { key: "todo: add the handler test", value: "VERIFIED" }];
    const other = [{ key: "todo: add the handler", value: "VERIFIED" }];
    expect(agreement(ref, other)).toMatchObject({ same: 1, missing: 1 });
  });
});

describe("verdictsFor", () => {
  it("reads the verdicts of a completion verifier", () => {
    const v = verdictsFor("verify-completion", {
      requirements: [{ requirement: "A", kind: "auto", status: "SATISFIED", evidence: "" }],
      todoItems: [{ item: "B", status: "INCOMPLETE", evidence: "" }],
      recommendations: [],
    });
    expect(v).toEqual([
      { key: "requirement: A", value: "SATISFIED" },
      { key: "todo: B", value: "INCOMPLETE" },
    ]);
  });

  it("treats the gate's decision and its unfinished repositories as verdicts, not its prose", () => {
    const v = verdictsFor("autonomous-gate", {
      shouldLoop: true,
      giveUp: false,
      reason: "two warnings left",
      fixableIssues: ["fix x"],
      unfinishedRepositories: ["api"],
    });
    expect(v).toEqual([
      { key: "shouldLoop", value: "true" },
      { key: "giveUp", value: "false" },
      { key: "unfinished: api", value: "listed" },
    ]);
  });

  it("returns nothing for output it cannot read", () => {
    expect(verdictsFor("readme-clarity-gate", "not an object")).toEqual([]);
  });
});
