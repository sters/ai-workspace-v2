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
});

describe("SUMMARY_REPORT_TEMPLATE", () => {
  it("surfaces a low-confidence finding count for the downstream gate", () => {
    expect(SUMMARY_REPORT_TEMPLATE).toMatch(/Low-Confidence Findings/i);
  });

  it("keeps confidence annotations on the carried-over warning list", () => {
    expect(SUMMARY_REPORT_TEMPLATE).toMatch(/Confidence/);
  });
});

describe("collector prompt", () => {
  const prompt = getCollectorSystemPrompt();

  it("extracts and preserves confidence annotations", () => {
    expect(prompt).toMatch(/Confidence/);
    expect(prompt.toLowerCase()).toMatch(/preserve|carry|keep/);
  });
});
