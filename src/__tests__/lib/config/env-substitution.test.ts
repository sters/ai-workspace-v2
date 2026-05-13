import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { substituteEnvVars } from "@/lib/config/env-substitution";

describe("substituteEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AIW_TEST_FOO = "foo-value";
    process.env.AIW_TEST_BAR = "bar-value";
    delete process.env.AIW_TEST_MISSING;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("substitutes a single placeholder", () => {
    expect(substituteEnvVars("token={ENV:AIW_TEST_FOO}")).toBe("token=foo-value");
  });

  it("substitutes multiple placeholders in one string", () => {
    expect(substituteEnvVars("{ENV:AIW_TEST_FOO}-{ENV:AIW_TEST_BAR}")).toBe("foo-value-bar-value");
  });

  it("leaves strings without placeholders untouched", () => {
    expect(substituteEnvVars("plain string")).toBe("plain string");
    expect(substituteEnvVars("")).toBe("");
  });

  it("substitutes recursively in objects", () => {
    const input = {
      botToken: "{ENV:AIW_TEST_FOO}",
      nested: { appToken: "{ENV:AIW_TEST_BAR}" },
    };
    expect(substituteEnvVars(input)).toEqual({
      botToken: "foo-value",
      nested: { appToken: "bar-value" },
    });
  });

  it("substitutes recursively in arrays", () => {
    expect(substituteEnvVars(["a", "{ENV:AIW_TEST_FOO}", "b"])).toEqual(["a", "foo-value", "b"]);
  });

  it("substitutes inside arrays of objects", () => {
    const input = [{ name: "x", value: "{ENV:AIW_TEST_FOO}" }];
    expect(substituteEnvVars(input)).toEqual([{ name: "x", value: "foo-value" }]);
  });

  it("passes through non-string scalars (number, boolean, null)", () => {
    expect(substituteEnvVars(42)).toBe(42);
    expect(substituteEnvVars(true)).toBe(true);
    expect(substituteEnvVars(false)).toBe(false);
    expect(substituteEnvVars(null)).toBe(null);
  });

  it("substitutes missing env vars with empty string and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(substituteEnvVars("token={ENV:AIW_TEST_MISSING}")).toBe("token=");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("AIW_TEST_MISSING");
  });

  it("does not match placeholders with lowercase characters", () => {
    expect(substituteEnvVars("{ENV:lowercase}")).toBe("{ENV:lowercase}");
    expect(substituteEnvVars("{ENV:Mixed_Case}")).toBe("{ENV:Mixed_Case}");
  });

  it("matches placeholders with digits and underscores (not at start)", () => {
    process.env.AIW_TEST_KEY_2 = "second";
    expect(substituteEnvVars("{ENV:AIW_TEST_KEY_2}")).toBe("second");
  });

  it("does not mutate the input object", () => {
    const input = { a: "{ENV:AIW_TEST_FOO}", b: { c: "{ENV:AIW_TEST_BAR}" } };
    const snapshot = JSON.parse(JSON.stringify(input));
    substituteEnvVars(input);
    expect(input).toEqual(snapshot);
  });

  it("handles undefined and complex empty cases", () => {
    expect(substituteEnvVars(undefined)).toBe(undefined);
    expect(substituteEnvVars({})).toEqual({});
    expect(substituteEnvVars([])).toEqual([]);
  });
});
