import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import type { GroupChild, PhaseFunctionContext } from "@/types/pipeline";
import type { TodoReviewFinding } from "@/types/prompts";

vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(async () => ({ content: "# Task", meta: { taskType: "feature" } })),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn((_ws: string, agent: string) => `/mock/prompts/${agent}.md`),
}));

vi.mock("@/lib/templates", () => ({
  buildReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  buildUpdaterPrompt: vi.fn(() => "updater-prompt"),
  buildTodoReviewResolutionInstruction: vi.fn(() => "resolution-instruction"),
  TODO_REVIEW_SCHEMA: { type: "object" },
}));

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const mockWrite = vi.fn();
const originalBunFile = Bun.file;
const originalBunWrite = Bun.write;
Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;
Bun.write = mockWrite as unknown as typeof Bun.write;

afterAll(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

import {
  buildReviewTodosPhase,
  formatUnresolvedFindingsSection,
  parseTodoReviewVerdict,
} from "@/lib/pipelines/actions/review-todos";
import { buildTodoReviewResolutionInstruction, buildUpdaterPrompt } from "@/lib/templates";

const mockBuildInstruction = vi.mocked(buildTodoReviewResolutionInstruction);
const mockBuildUpdaterPrompt = vi.mocked(buildUpdaterPrompt);

/** runChildGroup stub that feeds each child the verdict text keyed by its label. */
function makeCtx(options?: {
  verdicts?: Record<string, string>;
  groupResults?: (children: GroupChild[], round: number) => boolean[];
  interactionAnswers?: Record<string, string>;
}) {
  const rounds: GroupChild[][] = [];
  let round = 0;
  const ctx = {
    operationId: "op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async () => options?.interactionAnswers ?? {}),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async (children: GroupChild[]) => {
      rounds.push(children);
      for (const child of children) {
        const text = options?.verdicts?.[child.label];
        if (text !== undefined) child.onResultText?.(text);
      }
      const results = options?.groupResults?.(children, round) ?? children.map(() => true);
      round += 1;
      return results;
    }),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
  } as unknown as PhaseFunctionContext;
  return { ctx, rounds };
}

const ONE_REPO = [{ repoName: "frontend", worktreePath: "/ws/github.com/org/frontend" }];

const HAS_ISSUES = JSON.stringify({
  status: "has_issues",
  findings: [
    {
      kind: "risk",
      item: "[Refactor] Share the URL builders",
      detail: "The shared builder returns undefined, so the panel's <a> loses its href.",
      suggestedResolution: "Add the plain-text fallback.",
    },
  ],
});

const CLEAN = JSON.stringify({ status: "clean", findings: [] });

describe("parseTodoReviewVerdict", () => {
  it("returns the findings from a well-formed verdict", () => {
    const findings = parseTodoReviewVerdict(HAS_ISSUES);
    expect(findings).toHaveLength(1);
    expect(findings?.[0].kind).toBe("risk");
    expect(findings?.[0].suggestedResolution).toBe("Add the plain-text fallback.");
  });

  it("returns an empty list for a clean verdict", () => {
    expect(parseTodoReviewVerdict(CLEAN)).toEqual([]);
  });

  // Fail open: an unreadable verdict must not block init, but must be visible.
  it("returns null when the verdict cannot be read", () => {
    expect(parseTodoReviewVerdict("not json")).toBeNull();
    expect(parseTodoReviewVerdict("")).toBeNull();
    expect(parseTodoReviewVerdict(JSON.stringify({ status: "clean" }))).toBeNull();
  });

  it("drops entries with no item or detail rather than emitting a blank ask", () => {
    const findings = parseTodoReviewVerdict(
      JSON.stringify({
        status: "has_issues",
        findings: [
          { kind: "risk", item: "", detail: "x" },
          { kind: "risk", item: "y", detail: "  " },
          { kind: "risk", item: "keep", detail: "real" },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings?.[0].item).toBe("keep");
  });

  // Guessing "risk" or "blocking" from an unknown label would overstate the claim.
  it("coerces an unknown kind to unclear", () => {
    const findings = parseTodoReviewVerdict(
      JSON.stringify({ status: "has_issues", findings: [{ kind: "nit", item: "a", detail: "b" }] }),
    );
    expect(findings?.[0].kind).toBe("unclear");
  });

  it("reads a verdict wrapped in a fenced code block", () => {
    const findings = parseTodoReviewVerdict("```json\n" + HAS_ISSUES + "\n```");
    expect(findings).toHaveLength(1);
  });
});

describe("formatUnresolvedFindingsSection", () => {
  const findings: TodoReviewFinding[] = [
    { kind: "risk", item: "[Refactor] Share builders", detail: "href is lost", suggestedResolution: "add fallback" },
    { kind: "blocking", item: "[Setup] Submodule", detail: "which remote?" },
  ];

  it("renders each finding as a blocked TODO item so the executor sees it", () => {
    const section = formatUnresolvedFindingsSection(findings);
    expect(section).toMatch(/- \[!\]/);
    expect(section.match(/- \[!\]/g)).toHaveLength(2);
    expect(section).toContain("href is lost");
    expect(section).toContain("which remote?");
    expect(section).toContain("add fallback");
  });
});

describe("buildReviewTodosPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("- [ ] **[View]** Add the rows");
    mockBuildInstruction.mockReturnValue("resolution-instruction");
    mockBuildUpdaterPrompt.mockReturnValue("updater-prompt");
  });

  const phase = (repos = ONE_REPO, interactionLevel?: "low" | "mid" | "high") =>
    buildReviewTodosPhase({ workspace: "ws", wsPath: "/ws", repos, interactionLevel });

  it("asks each reviewer for a structured verdict", async () => {
    const { ctx, rounds } = makeCtx({ verdicts: { "review-frontend": CLEAN } });
    await phase().fn(ctx);

    expect(rounds[0][0].jsonSchema).toBeDefined();
    expect(rounds[0][0].onResultText).toBeInstanceOf(Function);
  });

  it("does not revise anything when every verdict is clean", async () => {
    const { ctx, rounds } = makeCtx({ verdicts: { "review-frontend": CLEAN } });
    const ok = await phase().fn(ctx);

    expect(ok).toBe(true);
    expect(rounds).toHaveLength(1);
    expect(mockBuildInstruction).not.toHaveBeenCalled();
  });

  it("revises the TODO from the findings, restricted to TODO files", async () => {
    const { ctx, rounds } = makeCtx({ verdicts: { "review-frontend": HAS_ISSUES } });
    await phase().fn(ctx);

    expect(rounds).toHaveLength(2);
    const reviser = rounds[1][0];
    expect(reviser.label).toContain("frontend");
    expect(reviser.stepType).toBe("update-todo");
    expect(reviser.allowedTools).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Edit\(.*TODO-\*\.md\)$/)]),
    );
    expect(reviser.allowedTools).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Edit\(.*\/\*\*\)$/)]),
    );

    const passed = mockBuildInstruction.mock.calls[0][0];
    expect(passed.findings).toHaveLength(1);
    expect(passed.findings[0].detail).toContain("loses its href");
  });

  it("leaves the plan alone when the verdict cannot be read", async () => {
    const { ctx, rounds } = makeCtx({ verdicts: { "review-frontend": "garbage" } });
    const ok = await phase().fn(ctx);

    expect(ok).toBe(true);
    expect(rounds).toHaveLength(1);
    expect(ctx.emitStatus).toHaveBeenCalledWith(expect.stringMatching(/could not read|no verdict/i));
  });

  // Nothing may vanish the way the old text verdict did.
  it("writes the findings into the TODO as blocked items when the reviser fails", async () => {
    const { ctx } = makeCtx({
      verdicts: { "review-frontend": HAS_ISSUES },
      groupResults: (children, round) => (round === 1 ? children.map(() => false) : children.map(() => true)),
    });
    await phase().fn(ctx);

    expect(mockWrite).toHaveBeenCalled();
    const written = String(mockWrite.mock.calls[0][1]);
    expect(written).toContain("loses its href");
    expect(written).toMatch(/- \[!\]/);
  });

  it("asks the user about blocking findings when interaction is high", async () => {
    const blocking = JSON.stringify({
      status: "has_issues",
      findings: [{ kind: "blocking", item: "[Setup] Submodule", detail: "which remote?" }],
    });
    const { ctx } = makeCtx({
      verdicts: { "review-frontend": blocking },
      interactionAnswers: { "which remote?": "the org mirror" },
    });
    await phase(ONE_REPO, "high").fn(ctx);

    expect(ctx.emitAsk).toHaveBeenCalled();
    expect(mockBuildInstruction.mock.calls[0][0].answers).toEqual([
      { detail: "which remote?", answer: "the org mirror" },
    ]);
  });

  it("resolves blocking findings itself when nobody is watching", async () => {
    const blocking = JSON.stringify({
      status: "has_issues",
      findings: [{ kind: "blocking", item: "[Setup] Submodule", detail: "which remote?" }],
    });
    const { ctx, rounds } = makeCtx({ verdicts: { "review-frontend": blocking } });
    await phase(ONE_REPO, "low").fn(ctx);

    expect(ctx.emitAsk).not.toHaveBeenCalled();
    expect(rounds).toHaveLength(2);
  });

  it("revises only the repositories that have findings", async () => {
    const repos = [
      ...ONE_REPO,
      { repoName: "bff", worktreePath: "/ws/github.com/org/bff" },
    ];
    const { ctx, rounds } = makeCtx({
      verdicts: { "review-frontend": HAS_ISSUES, "review-bff": CLEAN },
    });
    await phase(repos).fn(ctx);

    expect(rounds[1]).toHaveLength(1);
    expect(rounds[1][0].label).toContain("frontend");
  });

  it("skips repositories with no TODO file", async () => {
    mockFileExists.mockResolvedValue(false);
    const { ctx } = makeCtx();
    const ok = await phase().fn(ctx);

    expect(ok).toBe(true);
    expect(ctx.runChildGroup).not.toHaveBeenCalled();
    expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringMatching(/no todo files/i));
  });
});
