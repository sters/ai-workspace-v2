import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSuggesterPrompt,
  WORKSPACE_SUGGESTION_SCHEMA,
} from "@/lib/templates/prompts/workspace-suggester";

describe("workspace-suggester prompt", () => {
  it("builds a prompt containing workspace name, README, and operation output", () => {
    const prompt = buildWorkspaceSuggesterPrompt({
      workspaceName: "test-ws",
      readmeContent: "# My Project\n\nScope: fix auth module",
      operationOutput: "Found issue in logging module that is unrelated",
    });

    expect(prompt).toContain("test-ws");
    expect(prompt).toContain("fix auth module");
    expect(prompt).toContain("Found issue in logging module");
    expect(prompt).toContain("out of scope");
  });

  it("schema has required suggestions array", () => {
    expect(WORKSPACE_SUGGESTION_SCHEMA.type).toBe("object");
    expect(WORKSPACE_SUGGESTION_SCHEMA.required).toContain("suggestions");
    expect(WORKSPACE_SUGGESTION_SCHEMA.properties.suggestions.type).toBe("array");

    const itemProps = WORKSPACE_SUGGESTION_SCHEMA.properties.suggestions.items.properties;
    expect(itemProps.title).toBeDefined();
    expect(itemProps.description).toBeDefined();
  });
});
