import { describe, it, expect } from "vitest";
import {
  buildBestOfNReviewerPrompt,
  buildBestOfNFileReviewerPrompt,
  buildBestOfNFileSynthesizerPrompt,
} from "@/lib/templates/prompts/best-of-n-reviewer";
import type { BestOfNReviewerInput } from "@/types/prompts";

describe("buildBestOfNReviewerPrompt", () => {
  const baseInput: BestOfNReviewerInput = {
    workspaceName: "test-ws",
    operationType: "execute",
    candidates: [
      { label: "candidate-1", diff: "+added line 1", resultText: "Done" },
      { label: "candidate-2", diff: "+added line 2" },
    ],
    readmeContent: "# Test README\nSome description",
  };

  // The reviewer answers with a 1-based candidate number, so the numbering the
  // prompt shows has to line up with the labels.
  it("numbers candidates from 1 and reports the count", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("Candidate 1: candidate-1");
    expect(prompt).toContain("Candidate 2: candidate-2");
    expect(prompt).toContain("Number of Candidates: 2");
  });

  it("renders an empty diff as (no changes)", () => {
    const prompt = buildBestOfNReviewerPrompt({
      ...baseInput,
      candidates: [{ label: "candidate-1", diff: "" }],
    });
    expect(prompt).toContain("(no changes)");
  });
});

describe("buildBestOfNFileReviewerPrompt", () => {
  it("renders a candidate with no files as (no files)", () => {
    const prompt = buildBestOfNFileReviewerPrompt({
      operationType: "test",
      candidates: [{ label: "candidate-1", files: [] }],
    });
    expect(prompt).toContain("(no files)");
  });
});

describe("buildBestOfNFileSynthesizerPrompt", () => {
  it("names the base candidate and sources by their 1-based number", () => {
    const prompt = buildBestOfNFileSynthesizerPrompt({
      operationType: "test",
      candidates: [
        { label: "candidate-1", files: [{ name: "f.md", content: "alpha" }] },
        { label: "candidate-2", files: [{ name: "f.md", content: "beta" }] },
      ],
      baseCandidate: 2,
      sources: [1, 2],
      outputDir: "/out",
      fileNames: ["f.md"],
    });
    expect(prompt).toContain("Base Candidate: candidate-2");
    expect(prompt).toContain("candidate-1, candidate-2");
    expect(prompt).toContain("/out/f.md");
  });
});
