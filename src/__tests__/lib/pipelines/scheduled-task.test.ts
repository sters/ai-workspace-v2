// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseScheduledTaskPlan } from "@/lib/pipelines/scheduled-task";

const plan = { title: " Watch CI ", cron: "0 9 * * 1-5", overlap: "queue", prompt: " Check main. " };

describe("parseScheduledTaskPlan", () => {
  it("takes a well-formed plan, trimmed, as a disabled task carrying the request", () => {
    expect(parseScheduledTaskPlan(JSON.stringify(plan), "watch CI")).toEqual({
      title: "Watch CI",
      cron: "0 9 * * 1-5",
      overlap: "queue",
      prompt: "Check main.",
      request: "watch CI",
      enabled: false,
    });
  });

  it.each([
    ["an unparsable answer", "not json"],
    ["an invalid cron expression", JSON.stringify({ ...plan, cron: "every morning" })],
    ["a cron expression that never comes due", JSON.stringify({ ...plan, cron: "0 0 30 2 *" })],
    ["an unknown overlap", JSON.stringify({ ...plan, overlap: "later" })],
    ["an empty instruction", JSON.stringify({ ...plan, prompt: "  " })],
  ])("rejects %s with a reason", (_name, raw) => {
    expect(parseScheduledTaskPlan(raw, "r")).toEqual({ error: expect.any(String) });
  });
});
