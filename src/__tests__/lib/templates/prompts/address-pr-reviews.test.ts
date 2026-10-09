import { describe, it, expect } from "vitest";
import { getAddressPrReviewsInstruction } from "@/lib/templates/prompts/address-pr-reviews";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";

describe("getAddressPrReviewsInstruction", () => {
  const instruction = getAddressPrReviewsInstruction();

  // The heading is the contract between this instruction and create-pr, which
  // parses it out of the TODO file — a drifting heading silently drops replies.
  it("records threads under the heading create-pr reads", () => {
    expect(instruction).toContain(`## ${PR_REVIEW_THREADS_HEADING}`);
  });
});
