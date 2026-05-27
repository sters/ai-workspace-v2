import { describe, expect, it } from "vitest";
import {
  extractCreatedPrs,
  buildCompletionMessage,
} from "@/lib/slack-server/notifier";
import type { OperationEvent } from "@/types/operation";

function ev(data: string, phaseLabel?: string): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    data,
    timestamp: "2026-05-13T00:00:00.000Z",
    ...(phaseLabel && { phaseLabel }),
  };
}

/** Build an assistant event with a single Bash `tool_use` block. */
function bashUse(toolUseId: string, command: string, phaseLabel = "Create PR"): OperationEvent {
  return ev(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: toolUseId, name: "Bash", input: { command } },
        ],
      },
    }),
    phaseLabel,
  );
}

/** Build a user event with a `tool_result` block. */
function bashResult(
  toolUseId: string,
  content: unknown,
  opts: { isError?: boolean; phaseLabel?: string } = {},
): OperationEvent {
  return ev(
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content,
            is_error: opts.isError ?? false,
          },
        ],
      },
    }),
    opts.phaseLabel ?? "Create PR",
  );
}

describe("extractCreatedPrs", () => {
  it("returns empty when there are no events", () => {
    expect(extractCreatedPrs([])).toEqual([]);
  });

  it("extracts the PR URL from a `gh pr create` tool_result", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create --title 'x' --body 'y'"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/12\n"),
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://github.com/sters/ai-workspace-v2/pull/12"]);
  });

  it("ignores PR URLs that only appear in the PR body (tool_use input), not the created URL", () => {
    // Regression: PR body referenced an example PR like
    //   "result of release will be posted like [this](https://.../pull/502...)"
    // The actual created PR URL is only in the tool_result stdout.
    const out = extractCreatedPrs([
      bashUse(
        "tu_1",
        "gh pr create --body 'see https://github.com/sters/ai-workspace-v2/pull/502 for example'",
      ),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/3393"),
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://github.com/sters/ai-workspace-v2/pull/3393"]);
  });

  it("ignores tool_results from non-`gh pr create` Bash calls", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr view https://github.com/sters/ai-workspace-v2/pull/9"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/9"),
    ]);
    expect(out).toEqual([]);
  });

  it("ignores errored `gh pr create` results", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create --base main"),
      bashResult("tu_1", "error: a PR already exists for branch", { isError: true }),
    ]);
    expect(out).toEqual([]);
  });

  it("collects URLs across multiple successful `gh pr create` calls", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create --base main"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/1"),
      bashUse("tu_2", "gh pr create --base master"),
      bashResult("tu_2", "https://github.com/sters/other-repo/pull/9"),
    ]);
    expect(out.map((p) => p.url).sort()).toEqual([
      "https://github.com/sters/ai-workspace-v2/pull/1",
      "https://github.com/sters/other-repo/pull/9",
    ]);
  });

  it("deduplicates a URL that appears in multiple results", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/1"),
      bashUse("tu_2", "gh pr create"),
      bashResult("tu_2", "https://github.com/sters/ai-workspace-v2/pull/1"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("ignores events from non-Create-PR phases even with `gh pr create`", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create", "Execute"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/1", { phaseLabel: "Execute" }),
    ]);
    expect(out).toEqual([]);
  });

  it("ignores events with no phaseLabel", () => {
    const out = extractCreatedPrs([
      ev(JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1", content: "https://github.com/sters/ai-workspace-v2/pull/1" }],
        },
      })),
    ]);
    expect(out).toEqual([]);
  });

  it("excludes URLs that were already in the input description", () => {
    const out = extractCreatedPrs(
      [
        bashUse("tu_1", "gh pr create"),
        bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/12"),
      ],
      { inputDescription: "please base on https://github.com/sters/ai-workspace-v2/pull/12 and extend" },
    );
    expect(out).toEqual([]);
  });

  it("handles tool_result content as an array of text blocks", () => {
    const out = extractCreatedPrs([
      bashUse("tu_1", "gh pr create"),
      bashResult("tu_1", [
        { type: "text", text: "https://github.com/sters/ai-workspace-v2/pull/7" },
      ]),
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://github.com/sters/ai-workspace-v2/pull/7"]);
  });

  it("tolerates non-JSON event data without throwing", () => {
    const out = extractCreatedPrs([
      ev("not-json https://github.com/sters/ai-workspace-v2/pull/1", "Create PR"),
      bashUse("tu_1", "gh pr create"),
      bashResult("tu_1", "https://github.com/sters/ai-workspace-v2/pull/2"),
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://github.com/sters/ai-workspace-v2/pull/2"]);
  });
});

describe("buildCompletionMessage", () => {
  it("formats a list when PRs are present", () => {
    const msg = buildCompletionMessage([
      {
        url: "https://github.com/sters/ai-workspace-v2/pull/1",
        owner: "sters",
        repo: "ai-workspace-v2",
        repoPath: "github.com/sters/ai-workspace-v2",
        prNumber: 1,
      },
      {
        url: "https://github.com/sters/other-repo/pull/2",
        owner: "sters",
        repo: "other-repo",
        repoPath: "github.com/sters/other-repo",
        prNumber: 2,
      },
    ]);
    expect(msg).toBe(
      "Done! Created PRs:\n• https://github.com/sters/ai-workspace-v2/pull/1\n• https://github.com/sters/other-repo/pull/2",
    );
  });

  it("falls back to no-PRs message when empty", () => {
    expect(buildCompletionMessage([])).toBe(
      "Done! No PRs were created. Please check details on WebUI.",
    );
  });
});
