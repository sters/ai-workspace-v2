import { describe, expect, it } from "vitest";
import { parseReadmeMeta } from "@/lib/parsers/readme";

describe("parseReadmeMeta", () => {
  const sampleReadme = `# Task: Implement authentication flow

**Task Type**: feature
**Ticket ID**: AUTH-123
**Date**: 2024-01-15

## Repositories

- **auth-service**: \`github.com/org/auth-service\` (base: \`main\`)
- **frontend**: \`github.com/org/frontend\` (base: \`develop\`)
`;

  it("extracts the task title", () => {
    const meta = parseReadmeMeta(sampleReadme);
    expect(meta.title).toBe("Implement authentication flow");
  });

  it("extracts the task type", () => {
    const meta = parseReadmeMeta(sampleReadme);
    expect(meta.taskType).toBe("feature");
  });

  it("extracts the ticket ID", () => {
    const meta = parseReadmeMeta(sampleReadme);
    expect(meta.ticketId).toBe("AUTH-123");
  });

  it("extracts the date", () => {
    const meta = parseReadmeMeta(sampleReadme);
    expect(meta.date).toBe("2024-01-15");
  });

  it("extracts repositories", () => {
    const meta = parseReadmeMeta(sampleReadme);
    expect(meta.repositories).toHaveLength(2);
    expect(meta.repositories[0]).toEqual({
      alias: "auth-service",
      path: "github.com/org/auth-service",
      baseBranch: "main",
    });
    expect(meta.repositories[1]).toEqual({
      alias: "frontend",
      path: "github.com/org/frontend",
      baseBranch: "develop",
    });
  });

  it("returns defaults for missing fields", () => {
    const meta = parseReadmeMeta("Just some text without metadata");
    expect(meta.title).toBe("Untitled");
    expect(meta.taskType).toBe("unknown");
    expect(meta.ticketId).toBe("");
    expect(meta.date).toBe("");
    expect(meta.repositories).toEqual([]);
  });

  it("handles partial metadata", () => {
    const content = `# Task: Partial task
**Task Type**: bugfix`;
    const meta = parseReadmeMeta(content);
    expect(meta.title).toBe("Partial task");
    expect(meta.taskType).toBe("bugfix");
    expect(meta.ticketId).toBe("");
    expect(meta.date).toBe("");
    expect(meta.repositories).toEqual([]);
  });

  it("handles empty input", () => {
    const meta = parseReadmeMeta("");
    expect(meta.title).toBe("Untitled");
    expect(meta.taskType).toBe("unknown");
    expect(meta.repositories).toEqual([]);
  });

  it("handles multiple repositories correctly", () => {
    const content = `# Task: Multi-repo task

- **repo1**: \`path/to/repo1\` (base: \`main\`)
- **repo2**: \`path/to/repo2\` (base: \`staging\`)
- **repo3**: \`path/to/repo3\` (base: \`release\`)`;
    const meta = parseReadmeMeta(content);
    expect(meta.repositories).toHaveLength(3);
    expect(meta.repositories[2].alias).toBe("repo3");
    expect(meta.repositories[2].baseBranch).toBe("release");
  });
});
