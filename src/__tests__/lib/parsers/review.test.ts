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

  it("handles partial data", () => {
    const content = `**Repositories Reviewed**: 1`;
    const session = parseReviewSummary("ts", content);
    expect(session.repos).toBe(1);
    expect(session.critical).toBe(0);
    expect(session.warnings).toBe(0);
    expect(session.suggestions).toBe(0);
  });

  it("preserves the timestamp as-is", () => {
    const session = parseReviewSummary("custom-timestamp-format", "");
    expect(session.timestamp).toBe("custom-timestamp-format");
  });

  it("handles large numbers across many repos", () => {
    const content = `**Repositories Reviewed**: 3

### repo-a
| Metric | Count |
|--------|-------|
| Critical Issues | 500 |
| Warnings | 400 |
| Suggestions | 1000 |

### repo-b
| Metric | Count |
|--------|-------|
| Critical Issues | 499 |
| Warnings | 834 |
| Suggestions | 4678 |
`;
    const session = parseReviewSummary("ts", content);
    expect(session.repos).toBe(3);
    expect(session.critical).toBe(999);
    expect(session.warnings).toBe(1234);
    expect(session.suggestions).toBe(5678);
  });

  it("handles empty content", () => {
    const session = parseReviewSummary("ts", "");
    expect(session.repos).toBe(0);
    expect(session.critical).toBe(0);
    expect(session.warnings).toBe(0);
    expect(session.suggestions).toBe(0);
  });

  it("handles single repo", () => {
    const content = `**Repositories Reviewed**: 1

### github.com/org/repo

#### Code Review

| Metric | Count |
|--------|-------|
| Overall Assessment | Good |
| Critical Issues | 0 |
| Warnings | 5 |
| Suggestions | 10 |
`;
    const session = parseReviewSummary("ts", content);
    expect(session.repos).toBe(1);
    expect(session.critical).toBe(0);
    expect(session.warnings).toBe(5);
    expect(session.suggestions).toBe(10);
  });
});
