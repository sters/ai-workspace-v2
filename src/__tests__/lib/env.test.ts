import { describe, it, expect, afterEach } from "vitest";
import { getCleanEnv } from "@/lib/env";

const KEYS = ["AIW_SLACK_BOT_TOKEN", "AIW_SLACK_APP_TOKEN", "AIW_SOMETHING_NEW", "UNRELATED_VAR"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("getCleanEnv", () => {
  it("keeps every AIW_ variable, secrets included, out of child processes", () => {
    process.env.AIW_SLACK_BOT_TOKEN = "xoxb-test";
    process.env.AIW_SLACK_APP_TOKEN = "xapp-test";
    process.env.AIW_SOMETHING_NEW = "x";
    process.env.UNRELATED_VAR = "kept";

    const env = getCleanEnv();

    expect(env.AIW_SLACK_BOT_TOKEN).toBeUndefined();
    expect(env.AIW_SLACK_APP_TOKEN).toBeUndefined();
    expect(env.AIW_SOMETHING_NEW).toBeUndefined();
    expect(env.UNRELATED_VAR).toBe("kept");
  });

  it("lets a caller pass an AIW_ variable on purpose", () => {
    process.env.AIW_SOMETHING_NEW = "from-server";
    expect(getCleanEnv({ AIW_SOMETHING_NEW: "explicit" }).AIW_SOMETHING_NEW).toBe("explicit");
  });
});
