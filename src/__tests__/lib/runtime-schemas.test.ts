import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "@/lib/runtime-schemas";

/**
 * The validator between the browser and the chat server: a frame it rejects is
 * a frame `handleStart` never sees, so every field the client sends has to be
 * declared here.
 */
describe("clientMessageSchema", () => {
  it("accepts a start frame carrying a task for the session", () => {
    const parsed = clientMessageSchema.safeParse({
      type: "start",
      workspaceId: "feature-login-crash-20260915",
      cols: 120,
      rows: 40,
      task: "fix the login crash\nthe refresh path 500s",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      task: "fix the login crash\nthe refresh path 500s",
    });
  });

  it("accepts a start frame with no task", () => {
    const parsed = clientMessageSchema.safeParse({
      type: "start",
      workspaceId: "feature-login-crash-20260915",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a start frame with no workspace", () => {
    expect(clientMessageSchema.safeParse({ type: "start", workspaceId: "" }).success).toBe(false);
  });
});
