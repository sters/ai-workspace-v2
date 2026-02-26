import { describe, expect, it } from "vitest";
import { parseReviewSummary } from "@/lib/parsers/review";

describe("parseReviewSummary", () => {
  it("parses a complete review summary", () => {
    const content = `# Review Summary

**Repositories Reviewed**: 3
**Total Critical Issues**: 2
**Total Warnings**: 5
**Total Suggestions**: 10
`;
    const session = parseReviewSummary("2024-01-15T10:00:00", content);
    expect(session.timestamp).toBe("2024-01-15T10:00:00");
    expect(session.repos).toBe(3);
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
    const content = `**Repositories Reviewed**: 1
**Total Critical Issues**: 0`;
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

  it("handles large numbers", () => {
    const content = `**Repositories Reviewed**: 100
**Total Critical Issues**: 999
**Total Warnings**: 1234
**Total Suggestions**: 5678`;
    const session = parseReviewSummary("ts", content);
    expect(session.repos).toBe(100);
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
});
