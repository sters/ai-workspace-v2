import { describe, it, expect } from "vitest";
import {
  getPrValidationsPath,
  mergeValidations,
  normalizeVerdict,
  parseValidationStore,
} from "@/lib/workspace/pr-validations";
import type { PrThreadValidation } from "@/types/pull-request";

function validation(overrides: Partial<PrThreadValidation> = {}): PrThreadValidation {
  return {
    threadId: "PRRT_a",
    repoName: "widgets",
    commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1",
    verdict: "valid",
    interpretation: "The reviewer wants the lock released on the error path.",
    reasoning: "cache.ts:88 returns before unlock().",
    recommendation: "Wrap the body in try/finally.",
    evidence: ["src/cache.ts:88"],
    validatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("getPrValidationsPath", () => {
  it("lives beside the other workspace artifacts", () => {
    expect(getPrValidationsPath("/ws/feature-x")).toBe(
      "/ws/feature-x/artifacts/pr-validations.json",
    );
  });
});

describe("normalizeVerdict", () => {
  it("passes the three known verdicts through", () => {
    expect(normalizeVerdict("valid")).toBe("valid");
    expect(normalizeVerdict("invalid")).toBe("invalid");
    expect(normalizeVerdict("unclear")).toBe("unclear");
  });

  it("falls back to unclear for anything else", () => {
    // "unclear" is the only safe guess: it keeps the thread in front of a human
    // instead of asserting the comment is settled either way.
    expect(normalizeVerdict("VALID")).toBe("unclear");
    expect(normalizeVerdict(undefined)).toBe("unclear");
    expect(normalizeVerdict("probably fine")).toBe("unclear");
  });
});

describe("parseValidationStore", () => {
  it("reads back a store it wrote", () => {
    const store = mergeValidations(undefined, [validation()]);
    expect(parseValidationStore(JSON.stringify(store)).validations["PRRT_a"].verdict).toBe("valid");
  });

  it("returns an empty store for missing, empty or malformed content", () => {
    for (const raw of ["", "{oops", "null", "[]", JSON.stringify({ version: 1 })]) {
      expect(parseValidationStore(raw).validations).toEqual({});
    }
  });

  it("drops entries whose thread id does not match their key", () => {
    // A key/field mismatch means the file was hand-edited or written by an older
    // shape; joining on the wrong id would attach a verdict to another thread.
    const raw = JSON.stringify({
      version: 1,
      validations: { "PRRT_a": validation({ threadId: "PRRT_b" }) },
    });
    expect(parseValidationStore(raw).validations).toEqual({});
  });

  it("coerces an unknown stored verdict rather than trusting it", () => {
    const raw = JSON.stringify({
      version: 1,
      validations: { "PRRT_a": { ...validation(), verdict: "definitely" } },
    });
    expect(parseValidationStore(raw).validations["PRRT_a"].verdict).toBe("unclear");
  });
});

describe("mergeValidations", () => {
  it("creates a store when there is none", () => {
    const store = mergeValidations(undefined, [validation()]);
    expect(store.version).toBe(1);
    expect(Object.keys(store.validations)).toEqual(["PRRT_a"]);
  });

  it("re-validating a thread replaces the old verdict", () => {
    const first = mergeValidations(undefined, [validation({ verdict: "unclear" })]);
    const second = mergeValidations(first, [validation({ verdict: "valid", reasoning: "checked again" })]);
    expect(Object.keys(second.validations)).toEqual(["PRRT_a"]);
    expect(second.validations["PRRT_a"]).toMatchObject({ verdict: "valid", reasoning: "checked again" });
  });

  it("keeps verdicts for threads it was not asked about", () => {
    const first = mergeValidations(undefined, [validation({ threadId: "PRRT_a" })]);
    const second = mergeValidations(first, [validation({ threadId: "PRRT_b" })]);
    expect(Object.keys(second.validations).sort()).toEqual(["PRRT_a", "PRRT_b"]);
  });

  it("does not mutate the store it was given", () => {
    const first = mergeValidations(undefined, [validation({ threadId: "PRRT_a" })]);
    mergeValidations(first, [validation({ threadId: "PRRT_b" })]);
    expect(Object.keys(first.validations)).toEqual(["PRRT_a"]);
  });

  it("ignores entries with no thread id", () => {
    const store = mergeValidations(undefined, [validation({ threadId: "" })]);
    expect(store.validations).toEqual({});
  });
});
