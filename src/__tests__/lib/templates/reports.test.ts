import {
  REVIEW_REPORT_TEMPLATE,
  SUMMARY_REPORT_TEMPLATE,
} from "@/lib/templates/reports";
import { getCollectorSystemPrompt } from "@/lib/templates/prompts/collector";

describe("REVIEW_REPORT_TEMPLATE", () => {
  it("asks for a confidence annotation on every finding severity", () => {
    const sections = ["Critical Issues", "Warnings", "Suggestions"];
    for (const section of sections) {
      const idx = REVIEW_REPORT_TEMPLATE.indexOf(`#### ${section}`);
      expect(idx, `${section} section missing`).toBeGreaterThan(-1);
      const body = REVIEW_REPORT_TEMPLATE.slice(idx, idx + 200);
      expect(body, `${section} has no confidence annotation`).toMatch(/Confidence:/);
    }
  });

  it("still documents the positive-feedback section without a confidence tag", () => {
    const idx = REVIEW_REPORT_TEMPLATE.indexOf("#### Positive Feedback");
    expect(idx).toBeGreaterThan(-1);
    const body = REVIEW_REPORT_TEMPLATE.slice(idx, idx + 60);
    expect(body).not.toMatch(/Confidence:/);
  });

  // The free-text verdict slots invited a ship/no-ship call the reviewer is not
  // positioned to make (it sees no acceptance criteria, TODO files, ledger, or
  // fix-verification), and the gate is instructed to override it — so the same
  // file carried two contradictory answers. Observed: a review whose Conclusion
  // read "none blocking. Merge-ready" was looped on by the gate anyway.
  it("does not invite a merge/ship verdict in its summary slots", () => {
    const idx = REVIEW_REPORT_TEMPLATE.indexOf("## Overall Assessment");
    expect(idx).toBeGreaterThan(-1);
    const tail = REVIEW_REPORT_TEMPLATE.slice(idx);
    expect(tail).toMatch(/not.*(merge|ship|blocking)/i);
    expect(tail).not.toMatch(/\{Final assessment\}/);
  });
});

describe("SUMMARY_REPORT_TEMPLATE", () => {
  it("surfaces a low-confidence finding count for the downstream gate", () => {
    expect(SUMMARY_REPORT_TEMPLATE).toMatch(/Low-Confidence Findings/i);
  });

  it("keeps confidence annotations on the carried-over warning list", () => {
    expect(SUMMARY_REPORT_TEMPLATE).toMatch(/Confidence/);
  });

  // The collector copied the reviewer's verdict into a metrics-table row, which
  // rendered an opinion the gate must override as a counted fact.
  it("does not carry a merge/ship verdict into the metrics table", () => {
    expect(SUMMARY_REPORT_TEMPLATE).not.toMatch(/\| Overall Assessment \| \{assessment\} \|/);
  });

  // ...and the verdict must not simply relocate to the summary's own Conclusion,
  // which is where it also appeared verbatim.
  it("keeps the verdict out of its own conclusion", () => {
    const tail = SUMMARY_REPORT_TEMPLATE.slice(
      SUMMARY_REPORT_TEMPLATE.indexOf("## Conclusion"),
    );
    expect(tail).toMatch(/not.*(merge|ship|blocking)/i);
  });
});

describe("collector prompt", () => {
  const prompt = getCollectorSystemPrompt();

  it("extracts and preserves confidence annotations", () => {
    expect(prompt).toMatch(/Confidence/);
    expect(prompt.toLowerCase()).toMatch(/preserve|carry|keep/);
  });
});
