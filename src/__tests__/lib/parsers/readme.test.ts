import { describe, expect, it } from "vitest";
import {
  parseReadmeMeta,
  parseAcceptanceCriteria,
  normalizeRepoPath,
  denormalizeRepoPath,
} from "@/lib/parsers/readme";

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

  it("accepts bold labels with spaces and parens", () => {
    const content = `# Task: Multi-worktree

- **service (variant-a)**: \`github.com/org/service\` (base: \`main\`)`;
    const meta = parseReadmeMeta(content);
    expect(meta.repositories).toHaveLength(1);
    expect(meta.repositories[0].alias).toBe("service (variant-a)");
    expect(meta.repositories[0].path).toBe("github.com/org/service");
  });

  it("normalizes :alias path syntax to ___alias", () => {
    const content = `# Task: Aliased path

- **repo (a)**: \`github.com/org/repo:a\` (base: \`main\`)`;
    const meta = parseReadmeMeta(content);
    expect(meta.repositories).toHaveLength(1);
    expect(meta.repositories[0].path).toBe("github.com/org/repo___a");
  });

  it("keeps multiple aliased entries of the same repo distinct", () => {
    const content = `# Task: Four parallel branches

- **service (variant-a)**: \`github.com/org/service:variant-a\` (base: \`main\`)
- **service (variant-b)**: \`github.com/org/service:variant-b\` (base: \`main\`)
- **service (variant-c)**: \`github.com/org/service:variant-c\` (base: \`main\`)
- **service (variant-d)**: \`github.com/org/service:variant-d\` (base: \`main\`)`;
    const meta = parseReadmeMeta(content);
    expect(meta.repositories).toHaveLength(4);
    expect(meta.repositories.map((r) => r.path)).toEqual([
      "github.com/org/service___variant-a",
      "github.com/org/service___variant-b",
      "github.com/org/service___variant-c",
      "github.com/org/service___variant-d",
    ]);
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

describe("parseAcceptanceCriteria", () => {
  it("parses auto/manual tagged checkboxes", () => {
    const content = `# Task: Something

## Acceptance Criteria

- [ ] (auto) \`bun run test\` exits 0
- [x] (auto) /api/foo returns 200
- [ ] (manual) Open /dashboard in dev and confirm the panel renders

## Repository Constraints
`;
    const ac = parseAcceptanceCriteria(content);
    expect(ac).toHaveLength(3);
    expect(ac[0]).toEqual({ text: "`bun run test` exits 0", kind: "auto", checked: false });
    expect(ac[1]).toEqual({ text: "/api/foo returns 200", kind: "auto", checked: true });
    expect(ac[2]).toEqual({
      text: "Open /dashboard in dev and confirm the panel renders",
      kind: "manual",
      checked: false,
    });
  });

  it("defaults an untagged criterion to auto", () => {
    const content = `## Acceptance Criteria

- [ ] Login flow works end to end
`;
    const ac = parseAcceptanceCriteria(content);
    expect(ac).toHaveLength(1);
    expect(ac[0]).toEqual({ text: "Login flow works end to end", kind: "auto", checked: false });
  });

  it("accepts uppercase X and asterisk bullets", () => {
    const content = `## Acceptance Criteria

* [X] (manual) Screenshot approved
`;
    const ac = parseAcceptanceCriteria(content);
    expect(ac).toEqual([{ text: "Screenshot approved", kind: "manual", checked: true }]);
  });

  it("ignores checkboxes outside the Acceptance Criteria section", () => {
    const content = `## Requirements

- [ ] (auto) not a criterion, wrong section

## Acceptance Criteria

- [ ] (auto) real criterion

## Related Resources

- [ ] (manual) also ignored
`;
    const ac = parseAcceptanceCriteria(content);
    expect(ac).toEqual([{ text: "real criterion", kind: "auto", checked: false }]);
  });

  it("drops the empty tagged placeholder line from a fresh template", () => {
    const content = `## Acceptance Criteria

- [ ] (auto)
`;
    expect(parseAcceptanceCriteria(content)).toEqual([]);
  });

  it("returns empty when there is no Acceptance Criteria section", () => {
    expect(parseAcceptanceCriteria("# Task: x\n\n## Goal\n\nDo the thing")).toEqual([]);
  });

  it("ignores placeholder comment lines and blanks", () => {
    const content = `## Acceptance Criteria

<!-- (auto): verifiable by an agent -->
- [ ] (auto) something real
`;
    const ac = parseAcceptanceCriteria(content);
    expect(ac).toEqual([{ text: "something real", kind: "auto", checked: false }]);
  });
});

describe("normalizeRepoPath / denormalizeRepoPath", () => {
  it("converts :alias to ___alias and back", () => {
    expect(normalizeRepoPath("github.com/org/repo:a")).toBe("github.com/org/repo___a");
    expect(denormalizeRepoPath("github.com/org/repo___a")).toBe("github.com/org/repo:a");
  });

  it("leaves paths without an alias unchanged", () => {
    expect(normalizeRepoPath("github.com/org/repo")).toBe("github.com/org/repo");
    expect(denormalizeRepoPath("github.com/org/repo")).toBe("github.com/org/repo");
  });
});
