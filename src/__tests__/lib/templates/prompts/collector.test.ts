import { describe, it, expect } from "vitest";
import {
  getCollectorSystemPrompt,
  buildCollectorPrompt,
} from "@/lib/templates/prompts/collector";
import type { CollectorInput } from "@/types/prompts";

const baseInput: CollectorInput = {
  workspaceName: "ws",
  reviewTimestamp: "20260728-162200",
  reviewDir: "/ws/artifacts/reviews/20260728-162200",
  reviewFiles: ["/r/REVIEW-repo.md"],
  verifyFiles: ["/r/VERIFY-TODO-repo.md"],
  readmeVerifyFiles: ["/r/VERIFY-README-repo.md"],
  constraintFiles: ["/r/CONSTRAINTS-repo.md"],
};

describe("buildCollectorPrompt — fix verifications", () => {
  it("lists the fix-verification files when a cycle asked for fixes", () => {
    const prompt = buildCollectorPrompt({
      ...baseInput,
      fixVerifyFiles: ["/r/VERIFY-FIXES-repo.md"],
    });
    expect(prompt).toContain("Fix Verifications");
    expect(prompt).toContain("/r/VERIFY-FIXES-repo.md");
  });

  it("renders an empty fix-verification list on a first cycle", () => {
    const prompt = buildCollectorPrompt(baseInput);
    const section = prompt.split("Fix Verifications")[1]?.split("###")[0] ?? "";
    expect(section).toContain("(none)");
  });
});

describe("getCollectorSystemPrompt — fix verification handling", () => {
  const prompt = getCollectorSystemPrompt();

  it("tells the collector to carry NOT LANDED / PARTIAL into the summary", () => {
    expect(prompt).toContain("NOT LANDED");
    expect(prompt).toContain("PARTIAL");
  });

  // A requested fix that silently vanished is the failure this file exists to
  // surface, so it has to reach the top of SUMMARY.md rather than a footnote.
  it("puts an unlanded fix in the top priority list", () => {
    expect(prompt.toLowerCase()).toMatch(/top priority/);
  });

  // The counts feed the gate's severity reasoning; a verification status is not a
  // review finding and must not inflate them.
  it("keeps fix-verification statuses out of the Critical/Warning counts", () => {
    const section = prompt.split("Fix Verifications")[1] ?? prompt;
    expect(section).toMatch(/not?\s+.*count|out of the .*count/i);
  });
});
