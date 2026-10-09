import { describe, expect, it } from "vitest";
import { parseReviewSummary } from "@/lib/parsers/review";

describe("parseReviewSummary", () => {
  it("parses a complete review summary with per-repo tables", () => {
    const content = `# Workspace Review Summary

**Review Date**: 2024-01-15
**Repositories Reviewed**: 2

## Summary by Repository

### repo-a

#### Code Review

| Metric | Count |
|--------|-------|
| Overall Assessment | Good |
| Critical Issues | 1 |
| Warnings | 3 |
| Suggestions | 5 |

### repo-b

#### Code Review

| Metric | Count |
|--------|-------|
| Overall Assessment | Fair |
| Critical Issues | 1 |
| Warnings | 2 |
| Suggestions | 5 |
`;
    const session = parseReviewSummary("2024-01-15T10:00:00", content);
    expect(session.timestamp).toBe("2024-01-15T10:00:00");
    expect(session.repos).toBe(2);
    expect(session.critical).toBe(2);
    expect(session.warnings).toBe(5);
    expect(session.suggestions).toBe(10);
  });

  it("defaults to zero for missing fields", () => {
    const session = parseReviewSummary("2024-01-15", "No review data here");
    expect(session.repos).toBe(0);
    expect(session.critical).toBe(0);
    expect(session.warnings).toBe(0);
    expect(session.suggestions).toBe(0);
  });
});
