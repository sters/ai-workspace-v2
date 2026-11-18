import { describe, expect, it } from "vitest";
import { parseTriageVerdicts } from "@/lib/pipelines/check-pr-triage";

describe("parseTriageVerdicts", () => {
  const targets = ["u1", "u2", "u3"];

  it("keeps a comment open unless the answer says addressed", () => {
    const raw = JSON.stringify({
      results: [
        { url: "u1", verdict: "addressed", reason: "Replied with the fix" },
        { url: "u2", verdict: "maybe", reason: "?" },
        { url: "other", verdict: "addressed", reason: "not asked" },
      ],
    });
    expect(parseTriageVerdicts(raw, targets)).toEqual([
      { url: "u1", verdict: "addressed", reason: "Replied with the fix" },
      { url: "u2", verdict: "open", reason: "?" },
      { url: "u3", verdict: "open", reason: "No verdict returned" },
    ]);
  });

  it("keeps every comment open when the answer is unreadable", () => {
    expect(parseTriageVerdicts("not json", targets).map((v) => v.verdict)).toEqual(["open", "open", "open"]);
  });
});
