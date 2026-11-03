import { describe, expect, it } from "vitest";
import {
  buildReviewSummary,
  parseFixVerificationTable,
  parseReportItems,
  renderReadmeVerification,
  renderTodoVerification,
} from "@/lib/workspace/review-summary";
import type { RepoSummaryInput } from "@/lib/workspace/review-summary";
import { parseReviewSummary } from "@/lib/parsers/review";
import type { CompletionVerification } from "@/types/review-verification";


const verification: CompletionVerification = {
  requirements: [
    { requirement: "Endpoint returns 404 for unknown ids", kind: "auto", status: "SATISFIED", evidence: "src/a.ts:10" },
    { requirement: "Docs updated", kind: "auto", status: "UNSATISFIED", evidence: "no change under docs/" },
    // A manual criterion is a handoff, so the verifier's UNSATISFIED is not a failure.
    { requirement: "Staging sign-off", kind: "manual", status: "UNSATISFIED", evidence: "" },
  ],
  todoItems: [
    { item: "Add handler", status: "VERIFIED", evidence: "src/a.ts" },
    { item: "Add test", status: "INCOMPLETE", evidence: "no test file" },
    { item: "Rename flag", status: "SKIPPED", evidence: "" },
  ],
  recommendations: [],
};

describe("renderReadmeVerification", () => {
  it("computes the counts itself and keeps manual criteria out of the satisfaction rate", () => {
    const md = renderReadmeVerification("api", verification);
    expect(md).toContain("| Satisfied | 1 |");
    expect(md).toContain("| Unsatisfied | 1 |");
    expect(md).toContain("| Pending Human | 1 |");
    expect(md).toContain("**Satisfaction Rate**: 50% (1 / 2)");
    expect(md).toMatch(/## Staging sign-off\n\n- \*\*Status\*\*: PENDING-HUMAN/);
  });
});

describe("renderTodoVerification", () => {
  it("leaves skipped items out of the completion rate", () => {
    const md = renderTodoVerification("api", verification);
    expect(md).toContain("| Verified | 1 |");
    expect(md).toContain("| Incomplete | 1 |");
    expect(md).toContain("**Completion Rate**: 50% (1 / 2)");
  });
});

describe("parseReportItems", () => {
  it("counts top-level items under each heading, not their sub-bullets or a 'None.'", () => {
    const md = [
      "## Critical Issues", "", "None.", "",
      "## Warnings", "", "- None", "",
      "## Suggestions", "",
      "1. **Retention equals lifetime.** (Confidence: medium)",
      "   detail line",
      "   - Exposure: sub-bullet",
      "2. **Prefix differs.** (Confidence: high)", "",
      "## Recurring (previously accepted)", "", "- (Recurring) stale refs", "",
    ].join("\n");

    const items = parseReportItems(md);
    expect(items.critical).toEqual([]);
    expect(items.warning).toEqual([]);
    expect(items.suggestion.map((i) => [i.text, i.confidence])).toEqual([
      ["Retention equals lifetime.", "medium"],
      ["Prefix differs.", "high"],
    ]);
    expect(items.recurring).toEqual(["(Recurring) stale refs"]);
  });

  it("counts a sub-heading under a section as one item, and its bullets as its detail", () => {
    const md = [
      "## Critical Issues", "",
      "### C1. prod is missing dev's fix", "",
      "- **dev-add**:", "  - filters the list", "- **Fix**: port it", "",
      "## Warnings", "",
      // A "None" that goes on to list what was checked still means no warnings.
      "None. I checked the other boundaries in scope:", "",
      "- **prod-add ↔ prod-delete**: fine", "",
      "## Suggestions", "", "None.", "",
    ].join("\n");

    const items = parseReportItems(md);
    expect(items.critical.map((i) => i.text)).toEqual(["C1. prod is missing dev's fix"]);
    expect(items.warning).toEqual([]);
  });

  it("reads the per-file sections of a code review, including a finding tied to no file", () => {
    const md = [
      "## Detailed Review", "",
      "### src/a.ts", "", "#### Warnings", "- **Fallback misjudged.** (Confidence: high)", "",
      "#### Positive Feedback", "- Reads are batched.", "",
      "### Spec §8 validation (no file)", "", "#### Warnings", "- **No validation at import.** (Confidence: medium)", "",
      "#### Suggestions", "- None", "",
    ].join("\n");

    const items = parseReportItems(md);
    expect(items.warning.map((i) => [i.text, i.confidence])).toEqual([
      ["Fallback misjudged.", "high"],
      ["No validation at import.", "medium"],
    ]);
    expect(items.suggestion).toEqual([]);
  });
});

describe("parseFixVerificationTable", () => {
  it("reads each ask's status from the report's table", () => {
    const md = [
      "| # | Requested fix | Status | Evidence |",
      "|---|---|---|---|",
      "| 1 | Guard null id | LANDED | `a.ts:4` |",
      "| 2 | Add test | NOT LANDED | none |",
    ].join("\n");
    expect(parseFixVerificationTable(md)).toEqual([
      { number: "1", ask: "Guard null id", status: "LANDED" },
      { number: "2", ask: "Add test", status: "NOT LANDED" },
    ]);
  });
});

describe("buildReviewSummary", () => {
  const repo: RepoSummaryInput = {
    repoName: "api",
    reviewFile: "REVIEW-org_api.md",
    review: {
      critical: [{ text: "SQL built from input", confidence: "high" }],
      warning: [{ text: "Unused import", confidence: "low" }],
      suggestion: [{ text: "Rename", confidence: "medium" }],
      recurring: ["(Recurring) old thing"],
    },
    verification: { readmeFile: "VERIFY-README-org_api.md", todoFile: "VERIFY-TODO-org_api.md", data: verification },
    constraints: {
      file: "CONSTRAINTS-org_api.md",
      results: [
        { label: "test", command: "bun test", exitCode: 1, passed: false, stdout: "", stderr: "", timedOut: false, durationMs: 2000, status: "FAIL" },
      ],
    },
    fixes: { file: "VERIFY-FIXES-org_api.md", rows: [{ number: "1", ask: "Add test", status: "NOT LANDED" }] },
  };

  it("is read back by the review list with the counts it was built from", () => {
    const md = buildReviewSummary({ reviewTimestamp: "20261103-120000", repos: [repo], crossRepository: null });
    expect(parseReviewSummary("t", md)).toMatchObject({ repos: 1, critical: 1, warnings: 1, suggestions: 1 });
  });

  it("puts every blocker-shaped item in the top priority list, and recurring findings nowhere in it", () => {
    const md = buildReviewSummary({ reviewTimestamp: "20261103-120000", repos: [repo], crossRepository: null });
    const top = md.split("## Top Priority Issues")[1].split("\n## ")[0];
    expect(top).toContain("SQL built from input");
    expect(top).toContain("test");
    expect(top).toContain("Docs updated");
    expect(top).toContain("Add test");
    expect(top).not.toContain("Unused import");
    expect(top).not.toContain("old thing");
    expect(md).toContain("| Low-Confidence Findings | 1 |");
    expect(md).toContain("| Recurring (previously accepted) | 1 |");
  });

  it("names a repository whose verifier returned nothing instead of reporting it as clean", () => {
    const md = buildReviewSummary({
      reviewTimestamp: "20261103-120000",
      repos: [{ ...repo, verification: null, review: null }],
      crossRepository: null,
    });
    const failed = md.split("## Failed Reviews")[1];
    expect(failed).toContain("api");
  });

  it("counts the cross-repository review alongside the repositories", () => {
    const md = buildReviewSummary({
      reviewTimestamp: "20261103-120000",
      repos: [repo],
      crossRepository: {
        file: "REVIEW-cross-repository.md",
        items: { critical: [{ text: "Contract drift", confidence: "high" }], warning: [], suggestion: [], recurring: [] },
      },
    });
    expect(parseReviewSummary("t", md).critical).toBe(2);
    expect(md.split("## Top Priority Issues")[1].split("\n## ")[0]).toContain("Contract drift");
  });
});
