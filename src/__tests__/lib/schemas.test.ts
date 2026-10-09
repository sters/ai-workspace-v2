import { describe, it, expect } from "vitest";
import {
  workspacePruneSchema,
  operationPruneSchema,
  quickCreateWorkspaceSchema,
} from "@/lib/schemas";

describe.each([
  ["workspacePruneSchema", workspacePruneSchema],
  ["operationPruneSchema", operationPruneSchema],
])("%s archivedOnly", (_name, schema) => {
  it("defaults to archived workspaces only when omitted", () => {
    expect(schema.parse({}).archivedOnly).toBe(true);
  });

  it('reads the string "false" the form sends as false', () => {
    // z.coerce.boolean() would turn "false" into true and silently restore the
    // narrower scope the user had just unticked — or, the other way round for
    // a destructive flag, widen it.
    expect(schema.parse({ archivedOnly: "false" }).archivedOnly).toBe(false);
    expect(schema.parse({ archivedOnly: false }).archivedOnly).toBe(false);
    expect(schema.parse({ archivedOnly: "true" }).archivedOnly).toBe(true);
  });

  it("rejects a value that is not a boolean", () => {
    expect(schema.safeParse({ archivedOnly: "yes" }).success).toBe(false);
  });
});

describe("quickCreateWorkspaceSchema", () => {
  const REPOS = ["github.com/acme/web"];

  it("accepts a note with no name, since the name is derived from it", () => {
    const result = quickCreateWorkspaceSchema.safeParse({
      repositories: REPOS,
      note: "fix the login crash",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.name).toBe("");
    expect(result.success && result.data.taskType).toBe("feature");
  });

  it("accepts a name with no note", () => {
    expect(
      quickCreateWorkspaceSchema.safeParse({ name: "login crash", repositories: REPOS }).success,
    ).toBe(true);
  });

  it("rejects a request with nothing to name the workspace after", () => {
    const result = quickCreateWorkspaceSchema.safeParse({
      repositories: REPOS,
      note: "   \n  ",
    });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toMatch(/name or note/);
  });

  it("accepts a PR URL alone, since the server names it from the PR's title", () => {
    expect(
      quickCreateWorkspaceSchema.safeParse({
        repositories: ["https://github.com/acme/web/pull/42"],
      }).success,
    ).toBe(true);
  });
});
