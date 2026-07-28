import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const mockBunWrite = vi.fn();
const originalBunFile = Bun.file;
const originalBunWrite = Bun.write;

Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;

Bun.write = mockBunWrite as unknown as typeof Bun.write;

afterAll(() => {
  Bun.file = originalBunFile;
  Bun.write = originalBunWrite;
});

import {
  KNOWN_FINDINGS_HEADING,
  appendKnownFindings,
  getKnownFindingsPath,
  normalizeKnownFindingKind,
  parseKnownFindingSummaries,
  readKnownFindings,
  renderKnownFinding,
} from "@/lib/workspace/known-findings";

describe("getKnownFindingsPath", () => {
  it("lives under the workspace artifacts directory", () => {
    expect(getKnownFindingsPath("/ws/feature-x")).toBe(
      "/ws/feature-x/artifacts/known-findings.md",
    );
  });
});

describe("renderKnownFinding", () => {
  it("renders kind, cycle, summary and reason", () => {
    const line = renderKnownFinding({
      kind: "out-of-scope",
      cycle: 2,
      summary: "BFF collapses ShopOrders to obj[0]",
      reason: "Schema change owned by the contact-jp API team",
    });
    expect(line).toContain("**[out-of-scope]**");
    expect(line).toContain("(cycle 2)");
    expect(line).toContain("BFF collapses ShopOrders to obj[0]");
    expect(line).toContain("Schema change owned by the contact-jp API team");
  });

  it("omits the cycle marker when unknown", () => {
    const line = renderKnownFinding({
      kind: "infeasible",
      summary: "Criterion 4",
      reason: "No code change can satisfy it",
    });
    expect(line).not.toContain("(cycle");
  });

  it("collapses multi-line summaries and reasons onto one line each", () => {
    const line = renderKnownFinding({
      kind: "deferred",
      summary: "line one\nline two",
      reason: "because\nof things",
    });
    // The summary is the first bullet line; the reason is its single sub-bullet.
    expect(line.split("\n")).toHaveLength(2);
    expect(line).toContain("line one line two");
    expect(line).toContain("because of things");
  });
});

describe("parseKnownFindingSummaries", () => {
  it("extracts the summary of each entry, ignoring reason sub-bullets", () => {
    const content = [
      KNOWN_FINDINGS_HEADING,
      "",
      "- **[out-of-scope]** (cycle 1) BFF collapses ShopOrders to obj[0]",
      "  - Why not acted on: owned by another team",
      "- **[pre-existing]** golangci-lint v1/v2 config mismatch",
      "  - Why not acted on: environment, unrelated to this diff",
    ].join("\n");

    expect(parseKnownFindingSummaries(content)).toEqual([
      "BFF collapses ShopOrders to obj[0]",
      "golangci-lint v1/v2 config mismatch",
    ]);
  });

  it("returns nothing for empty or prose-only content", () => {
    expect(parseKnownFindingSummaries("")).toEqual([]);
    expect(parseKnownFindingSummaries("# Heading\n\nSome prose.\n")).toEqual([]);
  });
});

describe("normalizeKnownFindingKind", () => {
  it("passes through known kinds", () => {
    expect(normalizeKnownFindingKind("pending-human")).toBe("pending-human");
  });

  it("falls back to the weakest claim for unknown kinds", () => {
    // "deferred" only asserts "not acted on"; guessing a stronger kind would
    // mislabel the entry as permanently unactionable.
    expect(normalizeKnownFindingKind("banana")).toBe("deferred");
    expect(normalizeKnownFindingKind(undefined)).toBe("deferred");
  });
});

describe("readKnownFindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the file content when present", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("- **[deferred]** something\n");
    expect(await readKnownFindings("/ws/feature-x")).toBe("- **[deferred]** something\n");
  });

  it("returns an empty string when the ledger does not exist yet", async () => {
    mockFileExists.mockResolvedValue(false);
    expect(await readKnownFindings("/ws/feature-x")).toBe("");
  });

  it("returns an empty string when the file is unreadable", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockRejectedValue(new Error("boom"));
    expect(await readKnownFindings("/ws/feature-x")).toBe("");
  });
});

describe("appendKnownFindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(false);
    mockFileText.mockResolvedValue("");
  });

  it("creates the ledger with a header on first write", async () => {
    const added = await appendKnownFindings("/ws/feature-x", [
      { kind: "out-of-scope", summary: "Finding A", reason: "another team owns it", cycle: 1 },
    ]);

    expect(added).toHaveLength(1);
    expect(mockBunWrite).toHaveBeenCalledTimes(1);
    const [writtenPath, written] = mockBunWrite.mock.calls[0];
    expect(writtenPath).toBe("/ws/feature-x/artifacts/known-findings.md");
    expect(written).toContain(KNOWN_FINDINGS_HEADING);
    expect(written).toContain("Finding A");
  });

  it("appends to an existing ledger without rewriting the header", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue(
      `${KNOWN_FINDINGS_HEADING}\n\n- **[out-of-scope]** (cycle 1) Finding A\n  - Why not acted on: x\n`,
    );

    const added = await appendKnownFindings("/ws/feature-x", [
      { kind: "deferred", summary: "Finding B", reason: "suggestion, deferred to PR", cycle: 2 },
    ]);

    expect(added.map((f) => f.summary)).toEqual(["Finding B"]);
    const written = mockBunWrite.mock.calls[0][1] as string;
    expect(written.match(new RegExp(KNOWN_FINDINGS_HEADING, "g"))).toHaveLength(1);
    expect(written).toContain("Finding A");
    expect(written).toContain("Finding B");
  });

  it("skips findings already in the ledger, ignoring case and punctuation", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue(
      `${KNOWN_FINDINGS_HEADING}\n\n- **[out-of-scope]** (cycle 1) BFF collapses \`ShopOrders\` to obj[0]\n`,
    );

    const added = await appendKnownFindings("/ws/feature-x", [
      { kind: "out-of-scope", summary: "BFF collapses ShopOrders to obj[0].", reason: "same thing" },
      { kind: "deferred", summary: "Genuinely new", reason: "new" },
    ]);

    expect(added.map((f) => f.summary)).toEqual(["Genuinely new"]);
  });

  it("de-duplicates within a single batch", async () => {
    const added = await appendKnownFindings("/ws/feature-x", [
      { kind: "deferred", summary: "Same finding", reason: "a" },
      { kind: "deferred", summary: "same  finding", reason: "b" },
    ]);
    expect(added).toHaveLength(1);
  });

  it("does not write when there is nothing new to add", async () => {
    const added = await appendKnownFindings("/ws/feature-x", []);
    expect(added).toEqual([]);
    expect(mockBunWrite).not.toHaveBeenCalled();
  });

  it("drops entries with an empty summary", async () => {
    const added = await appendKnownFindings("/ws/feature-x", [
      { kind: "deferred", summary: "   ", reason: "nothing" },
    ]);
    expect(added).toEqual([]);
    expect(mockBunWrite).not.toHaveBeenCalled();
  });
});
