import { describe, it, expect } from "vitest";
import {
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

