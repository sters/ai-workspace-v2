import { describe, it, expect } from "vitest";
import {
  getBestOfNReviewerSystemPrompt,
  buildBestOfNReviewerPrompt,
  getBestOfNFileReviewerSystemPrompt,
  buildBestOfNFileReviewerPrompt,
  buildBestOfNFileSynthesizerPrompt,
  BEST_OF_N_REVIEW_SCHEMA,
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

  it("includes workspace name and operation type", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("test-ws");
    expect(prompt).toContain("execute");
  });

  it("includes all candidate diffs", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("Candidate 1: candidate-1");
    expect(prompt).toContain("+added line 1");
    expect(prompt).toContain("Candidate 2: candidate-2");
    expect(prompt).toContain("+added line 2");
  });

  it("includes result text when available", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("Result Summary");
    expect(prompt).toContain("Done");
  });

  it("handles candidates with no diff", () => {
    const input: BestOfNReviewerInput = {
      ...baseInput,
      candidates: [{ label: "candidate-1", diff: "" }],
    };
    const prompt = buildBestOfNReviewerPrompt(input);
    expect(prompt).toContain("(no changes)");
  });

  it("includes README content", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("# Test README");
    expect(prompt).toContain("Some description");
  });

  it("includes number of candidates", () => {
    const prompt = buildBestOfNReviewerPrompt(baseInput);
    expect(prompt).toContain("Number of Candidates: 2");
  });

  it("instructs select vs synthesize decision", () => {
    const systemPrompt = getBestOfNReviewerSystemPrompt();
    expect(systemPrompt).toContain("select");
    expect(systemPrompt).toContain("synthesize");
  });

  it("handles 3+ candidates", () => {
    const input: BestOfNReviewerInput = {
      ...baseInput,
      candidates: [
        { label: "candidate-1", diff: "+line1" },
        { label: "candidate-2", diff: "+line2" },
        { label: "candidate-3", diff: "+line3" },
      ],
    };
    const prompt = buildBestOfNReviewerPrompt(input);
    expect(prompt).toContain("Candidate 3: candidate-3");
    expect(prompt).toContain("+line3");
    expect(prompt).toContain("Number of Candidates: 3");
  });
});

describe("buildBestOfNFileReviewerPrompt", () => {
  it("includes file contents from candidates", () => {
    const prompt = buildBestOfNFileReviewerPrompt({
      operationType: "plan-todo",
      candidates: [
        { label: "candidate-1", files: [{ name: "TODO-repo.md", content: "# TODO\n- [ ] Task 1" }] },
        { label: "candidate-2", files: [{ name: "TODO-repo.md", content: "# TODO\n- [ ] Task 2" }] },
      ],
    });
    expect(prompt).toContain("plan-todo");
    expect(prompt).toContain("Candidate 1: candidate-1");
    expect(prompt).toContain("Task 1");
    expect(prompt).toContain("Candidate 2: candidate-2");
    expect(prompt).toContain("Task 2");
  });

  it("handles candidates with no files", () => {
    const prompt = buildBestOfNFileReviewerPrompt({
      operationType: "test",
      candidates: [{ label: "candidate-1", files: [] }],
    });
    expect(prompt).toContain("(no files)");
  });

  it("includes select and synthesize instructions", () => {
    const systemPrompt = getBestOfNFileReviewerSystemPrompt();
    expect(systemPrompt).toContain("select");
    expect(systemPrompt).toContain("synthesize");
  });
});

describe("buildBestOfNFileSynthesizerPrompt", () => {
  it("includes base candidate and sources", () => {
    const prompt = buildBestOfNFileSynthesizerPrompt({
      operationType: "plan-todo",
      candidates: [
        { label: "candidate-1", files: [{ name: "TODO.md", content: "content1" }] },
        { label: "candidate-2", files: [{ name: "TODO.md", content: "content2" }] },
      ],
      baseCandidate: 1,
      sources: [1, 2],
      outputDir: "/tmp/output",
      fileNames: ["TODO.md"],
    });
    expect(prompt).toContain("Base Candidate: candidate-1");
    expect(prompt).toContain("candidate-1, candidate-2");
    expect(prompt).toContain("/tmp/output/TODO.md");
  });

  it("includes candidate file contents", () => {
    const prompt = buildBestOfNFileSynthesizerPrompt({
      operationType: "test",
      candidates: [
        { label: "c1", files: [{ name: "f.md", content: "alpha" }] },
        { label: "c2", files: [{ name: "f.md", content: "beta" }] },
      ],
      baseCandidate: 2,
      sources: [1, 2],
      outputDir: "/out",
      fileNames: ["f.md"],
    });
    expect(prompt).toContain("alpha");
    expect(prompt).toContain("beta");
    expect(prompt).toContain("Base Candidate: candidate-2");
  });
});

describe("BEST_OF_N_REVIEW_SCHEMA", () => {
  it("has required action and candidate fields", () => {
    expect(BEST_OF_N_REVIEW_SCHEMA.required).toContain("action");
    expect(BEST_OF_N_REVIEW_SCHEMA.required).toContain("candidate");
    expect(BEST_OF_N_REVIEW_SCHEMA.required).toContain("reasoning");
  });

  it("defines select and synthesize as action options", () => {
    const actionProp = BEST_OF_N_REVIEW_SCHEMA.properties.action;
    expect(actionProp.enum).toEqual(["select", "synthesize"]);
  });

  it("defines sources as array of numbers", () => {
    const sourcesProp = BEST_OF_N_REVIEW_SCHEMA.properties.sources;
    expect(sourcesProp.type).toBe("array");
    expect(sourcesProp.items.type).toBe("number");
  });
});
