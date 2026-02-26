import { describe, it, expect } from "vitest";
import {
  initSchema,
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

  it("accepts workspace with draft", () => {
    const result = createPrSchema.safeParse({ workspace: "test", draft: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.draft).toBe(true);
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

  it("accepts days parameter", () => {
    const result = workspacePruneSchema.safeParse({ days: 14 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.days).toBe(14);
  });

  it("rejects negative days", () => {
    expect(workspacePruneSchema.safeParse({ days: -1 }).success).toBe(false);
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
