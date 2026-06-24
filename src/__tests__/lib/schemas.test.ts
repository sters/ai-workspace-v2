import { describe, it, expect } from "vitest";
import {
  initSchema,
  initFromPrSchema,
  workspaceSchema,
  createPrSchema,
  updateTodoSchema,
  workspacePruneSchema,
  operationKillSchema,
  operationAnswerSchema,
  mcpAuthSchema,
} from "@/lib/schemas";

describe("initSchema", () => {
  it("accepts valid input", () => {
    expect(initSchema.safeParse({ description: "test" }).success).toBe(true);
  });

  it("rejects empty description", () => {
    expect(initSchema.safeParse({ description: "" }).success).toBe(false);
  });

  it("rejects missing description", () => {
    expect(initSchema.safeParse({}).success).toBe(false);
  });
});

describe("initFromPrSchema", () => {
  it("accepts a PR url", () => {
    const result = initFromPrSchema.safeParse({
      prUrl: "https://github.com/org/repo/pull/123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty prUrl", () => {
    expect(initFromPrSchema.safeParse({ prUrl: "" }).success).toBe(false);
  });

  it("rejects missing prUrl", () => {
    expect(initFromPrSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a todoInstruction string and coerces withReview", () => {
    const result = initFromPrSchema.safeParse({
      prUrl: "https://github.com/org/repo/pull/1",
      todoInstruction: "Plan TODOs for tests",
      withReview: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.todoInstruction).toBe("Plan TODOs for tests");
      expect(result.data.withReview).toBe(true);
    }
  });

  it("accepts an interaction level", () => {
    const result = initFromPrSchema.safeParse({
      prUrl: "https://github.com/org/repo/pull/1",
      interactionLevel: "high",
    });
    expect(result.success).toBe(true);
  });
});

describe("workspaceSchema", () => {
  it("accepts valid workspace", () => {
    expect(workspaceSchema.safeParse({ workspace: "my-ws" }).success).toBe(true);
  });

  it("rejects empty workspace", () => {
    expect(workspaceSchema.safeParse({ workspace: "" }).success).toBe(false);
  });
});

describe("createPrSchema", () => {
  it("accepts workspace only", () => {
    expect(createPrSchema.safeParse({ workspace: "test" }).success).toBe(true);
  });

  it("accepts workspace with draft boolean", () => {
    const result = createPrSchema.safeParse({ workspace: "test", draft: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.draft).toBe(true);
  });

  it("coerces draft string to boolean", () => {
    const result = createPrSchema.safeParse({ workspace: "test", draft: "true" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.draft).toBe(true);
  });

  it("accepts optional repository", () => {
    const result = createPrSchema.safeParse({ workspace: "test", repository: "owner/repo" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.repository).toBe("owner/repo");
  });

  it("accepts without repository", () => {
    const result = createPrSchema.safeParse({ workspace: "test" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.repository).toBeUndefined();
  });
});

describe("updateTodoSchema", () => {
  it("accepts valid input", () => {
    expect(
      updateTodoSchema.safeParse({ workspace: "ws", instruction: "do stuff" }).success
    ).toBe(true);
  });

  it("rejects missing instruction", () => {
    expect(
      updateTodoSchema.safeParse({ workspace: "ws" }).success
    ).toBe(false);
  });
});

describe("workspacePruneSchema", () => {
  it("accepts empty body", () => {
    expect(workspacePruneSchema.safeParse({}).success).toBe(true);
  });

  it("accepts days as number", () => {
    const result = workspacePruneSchema.safeParse({ days: 14 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days).toBe(14);
  });

  it("coerces days from string to number", () => {
    const result = workspacePruneSchema.safeParse({ days: "14" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days).toBe(14);
  });

  it("rejects negative days", () => {
    expect(workspacePruneSchema.safeParse({ days: -1 }).success).toBe(false);
  });

  it("rejects negative days as string", () => {
    expect(workspacePruneSchema.safeParse({ days: "-1" }).success).toBe(false);
  });
});

describe("operationKillSchema", () => {
  it("accepts valid operationId", () => {
    expect(
      operationKillSchema.safeParse({ operationId: "pipe-1" }).success
    ).toBe(true);
  });

  it("rejects empty operationId", () => {
    expect(
      operationKillSchema.safeParse({ operationId: "" }).success
    ).toBe(false);
  });
});

describe("operationAnswerSchema", () => {
  it("accepts valid input", () => {
    expect(
      operationAnswerSchema.safeParse({
        operationId: "pipe-1",
        toolUseId: "tool-1",
        answers: { q1: "a1" },
      }).success
    ).toBe(true);
  });

  it("rejects missing answers", () => {
    expect(
      operationAnswerSchema.safeParse({
        operationId: "pipe-1",
        toolUseId: "tool-1",
      }).success
    ).toBe(false);
  });
});

describe("mcpAuthSchema", () => {
  it("accepts serverName", () => {
    expect(
      mcpAuthSchema.safeParse({ serverName: "my-server" }).success
    ).toBe(true);
  });

  it("accepts forceReauth boolean", () => {
    const result = mcpAuthSchema.safeParse({ serverName: "s", forceReauth: true });
    expect(result.success).toBe(true);
  });

  it("accepts forceReauth string", () => {
    const result = mcpAuthSchema.safeParse({ serverName: "s", forceReauth: "true" });
    expect(result.success).toBe(true);
  });

  it("rejects empty serverName", () => {
    expect(mcpAuthSchema.safeParse({ serverName: "" }).success).toBe(false);
  });
});
