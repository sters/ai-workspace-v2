import { describe, it, expect } from "vitest";
import { getAddressPrReviewsInstruction } from "@/lib/templates/prompts/address-pr-reviews";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";

describe("getAddressPrReviewsInstruction", () => {
  const instruction = getAddressPrReviewsInstruction();

  it("gathers both review comments and failing CI checks", () => {
    expect(instruction).toContain("gh pr view --comments");
    expect(instruction).toContain("gh pr checks");
    expect(instruction).toContain("--log-failed");
  });

  // The heading is the contract between this instruction and create-pr, which
  // parses it out of the TODO file — a drifting heading silently drops replies.
  it("records threads under the heading create-pr reads", () => {
    expect(instruction).toContain(`## ${PR_REVIEW_THREADS_HEADING}`);
  });

  // Without the GraphQL node ID there is nothing to resolve later: the REST
  // comment id can be replied to but only GraphQL can resolve a thread.
  it("captures the GraphQL review thread node id", () => {
    expect(instruction).toContain("reviewThreads");
    expect(instruction).toContain("isResolved");
  });

  // "未完了ならやらなくていい": this step judges and plans, it never speaks for
  // work that has not been pushed yet.
  it("forbids replying or resolving at triage time", () => {
    expect(instruction.toLowerCase()).toMatch(/do not reply/);
    expect(instruction.toLowerCase()).toMatch(/do not resolve|nor resolve/);
  });

  it("still routes invalid comments to Notes instead of a GitHub reply", () => {
    expect(instruction).toContain("## Notes");
  });
});
