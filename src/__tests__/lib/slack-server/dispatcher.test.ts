import { describe, expect, it } from "vitest";
import { buildRequest } from "@/lib/slack-server/dispatcher";
import { initSchema, autonomousSchema, updateTodoSchema } from "@/lib/schemas";

describe("buildRequest", () => {
  it("init (default) → autonomous endpoint with startWith=init", () => {
    const r = buildRequest({ op: "init", only: false, description: "do a thing" });
    expect(r.path).toBe("/api/operations/autonomous");
    expect(r.body).toEqual({
      startWith: "init",
      description: "do a thing",
      interactionLevel: "low",
    });
    expect(autonomousSchema.safeParse(r.body).success).toBe(true);
  });

  it("init --only → init endpoint", () => {
    const r = buildRequest({ op: "init", only: true, description: "do a thing" });
    expect(r.path).toBe("/api/operations/init");
    expect(r.body).toEqual({ description: "do a thing", interactionLevel: "low" });
    expect(initSchema.safeParse(r.body).success).toBe(true);
  });

  describe("in a thread bound to a workspace", () => {
    it("init → autonomous on that workspace, starting from its TODOs", () => {
      const r = buildRequest({ op: "init", only: false, description: "also cover the retry path" }, "feature-login-20261020");
      expect(r.path).toBe("/api/operations/autonomous");
      expect(r.body).toEqual({
        startWith: "update-todo",
        workspace: "feature-login-20261020",
        instruction: "also cover the retry path",
        interactionLevel: "low",
      });
      expect(autonomousSchema.safeParse(r.body).success).toBe(true);
    });

    it("init --only → update-todo on that workspace", () => {
      const r = buildRequest({ op: "init", only: true, description: "also cover the retry path" }, "feature-login-20261020");
      expect(r.path).toBe("/api/operations/update-todo");
      expect(r.body).toEqual({
        workspace: "feature-login-20261020",
        instruction: "also cover the retry path",
        interactionLevel: "low",
      });
      expect(updateTodoSchema.safeParse(r.body).success).toBe(true);
    });
  });
});
