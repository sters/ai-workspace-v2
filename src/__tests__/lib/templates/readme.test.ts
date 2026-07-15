import { describe, expect, it } from "vitest";
import { buildReadmeContent } from "@/lib/templates/readme";

describe("buildReadmeContent", () => {
  const content = buildReadmeContent("Fix the login bug", "bugfix", "AUTH-1", "2026-07-15");

  it("embeds the raw description, task type, ticket, and date", () => {
    expect(content).toContain("Fix the login bug");
    expect(content).toContain("**Task Type**: bugfix");
    expect(content).toContain("**Ticket ID**: AUTH-1");
    expect(content).toContain("**Date**: 2026-07-15");
  });

  it("includes the done-contract sections", () => {
    expect(content).toContain("## Goal");
    expect(content).toContain("## Non-Goal");
    expect(content).toContain("## Assumptions");
    expect(content).toContain("## Requirements");
    expect(content).toContain("## Acceptance Criteria");
  });

  it("documents the (auto)/(manual) acceptance-criteria tags", () => {
    expect(content).toContain("(auto)");
    expect(content).toContain("(manual)");
  });
});
