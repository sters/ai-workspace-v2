import { describe, expect, it } from "vitest";
import { buildRequest } from "@/lib/slack-server/dispatcher";
import { initSchema, autonomousSchema } from "@/lib/schemas";

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

  it("forces interactionLevel=low in both modes", () => {
    expect(buildRequest({ op: "init", only: false, description: "x" }).body.interactionLevel).toBe("low");
    expect(buildRequest({ op: "init", only: true, description: "x" }).body.interactionLevel).toBe("low");
  });
});
