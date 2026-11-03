import { REVIEW_REPORT_TEMPLATE } from "@/lib/templates/reports";

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

  // The reviewer sees no acceptance criteria, TODO files, ledger, or
  // fix-verification, so it is not positioned to make a ship/no-ship call, and
  // the gate is instructed to override one — the file would carry two
  // contradictory answers.
  it("does not invite a merge/ship verdict in its summary slots", () => {
    const idx = REVIEW_REPORT_TEMPLATE.indexOf("## Overall Assessment");
    expect(idx).toBeGreaterThan(-1);
    const tail = REVIEW_REPORT_TEMPLATE.slice(idx);
    expect(tail).toMatch(/not.*(merge|ship|blocking)/i);
    expect(tail).not.toMatch(/\{Final assessment\}/);
  });
});
