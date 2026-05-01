import { describe, expect, it } from "vitest";
import { parseConstraints } from "@/lib/parsers/readme";

describe("parseConstraints", () => {
  it("parses a single repo with multiple constraints", () => {
    const content = `# Task: Something

## Repository Constraints

### my-repo

- All changes MUST pass the following checks before completion:
  - Lint: \`make lint\`
  - Test: \`go test ./...\`
  - Build: \`go build ./...\`
`;
    const result = parseConstraints(content);
    expect(result).toHaveLength(1);
    expect(result[0].repoName).toBe("my-repo");
    expect(result[0].constraints).toEqual([
      { label: "Lint", command: "make lint" },
      { label: "Test", command: "go test ./..." },
      { label: "Build", command: "go build ./..." },
    ]);
  });

  it("parses multiple repos", () => {
    const content = `## Repository Constraints

### frontend

- All changes MUST pass the following checks before completion:
  - Lint: \`npm run lint\`
  - Test: \`npm run test\`

### backend

- All changes MUST pass the following checks before completion:
  - Lint: \`make lint\`
`;
    const result = parseConstraints(content);
    expect(result).toHaveLength(2);
    expect(result[0].repoName).toBe("frontend");
    expect(result[0].constraints).toHaveLength(2);
    expect(result[1].repoName).toBe("backend");
    expect(result[1].constraints).toEqual([
      { label: "Lint", command: "make lint" },
    ]);
  });

  it("returns empty array when no section exists", () => {
    const content = `# Task: Something

## Repositories

- **repo**: \`path/to/repo\` (base: \`main\`)
`;
    expect(parseConstraints(content)).toEqual([]);
  });

  it("returns empty array when section is empty", () => {
    const content = `## Repository Constraints

<!-- Constraints will be added during init -->

## Related Resources
`;
    expect(parseConstraints(content)).toEqual([]);
  });

  it("handles constraint labels with spaces", () => {
    const content = `## Repository Constraints

### my-repo

- Type Check: \`tsc --noEmit\`
`;
    const result = parseConstraints(content);
    expect(result[0].constraints).toEqual([
      { label: "Type Check", command: "tsc --noEmit" },
    ]);
  });

  it("ignores lines without backtick-wrapped commands", () => {
    const content = `## Repository Constraints

### my-repo

- All changes MUST pass the following checks before completion:
  - Lint: \`make lint\`
  - This is just a note without a command
  - Test: \`npm test\`
`;
    const result = parseConstraints(content);
    expect(result[0].constraints).toEqual([
      { label: "Lint", command: "make lint" },
      { label: "Test", command: "npm test" },
    ]);
  });

  it("stops at the next ## heading", () => {
    const content = `## Repository Constraints

### my-repo

- Lint: \`make lint\`

## Related Resources

### not-a-repo

- Test: \`should not be parsed\`
`;
    const result = parseConstraints(content);
    expect(result).toHaveLength(1);
    expect(result[0].repoName).toBe("my-repo");
  });

  it("handles empty input", () => {
    expect(parseConstraints("")).toEqual([]);
  });

  it("skips repo sections with no parseable constraints", () => {
    const content = `## Repository Constraints

### empty-repo

- No specific constraints identified

### good-repo

- Lint: \`eslint .\`
`;
    const result = parseConstraints(content);
    expect(result).toHaveLength(1);
    expect(result[0].repoName).toBe("good-repo");
  });
});
