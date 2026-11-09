import { describe, it, expect } from "vitest";
import {
  buildVerificationChatTopic,
  editableFrom,
  expandCommand,
  expandText,
  extractOutputs,
  renderVerificationResults,
} from "@/lib/verification/model";
import type { VerificationScenario, VerificationStep } from "@/types/verification";

function step(over: Partial<VerificationStep>): VerificationStep {
  return { id: "s1", title: "t", actor: "claude", status: "pending", revision: 0, ...over };
}

function scenario(over: Partial<VerificationScenario>): VerificationScenario {
  return {
    id: "orders",
    title: "Orders list",
    summary: "",
    status: "ready",
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    variables: {},
    steps: [],
    processes: [],
    ...over,
  };
}

describe("expandCommand", () => {
  it("shell-quotes a value so input containing quotes and metacharacters stays one word", () => {
    const out = expandCommand("echo {{name}}", { name: `it's $(rm -rf x); "y"` });
    expect(out).toEqual({ ok: true, command: `echo 'it'\\''s $(rm -rf x); "y"'` });
  });

  it("refuses a command naming a variable that has no value yet", () => {
    expect(expandCommand("curl /orders/{{order_id}}", {})).toEqual({
      ok: false,
      error: "Unknown variable: order_id",
    });
  });
});

describe("expandText", () => {
  it("substitutes known variables and leaves unknown ones visible", () => {
    expect(expandText("open {{url}} as {{who}}", { url: "http://localhost:3000" })).toBe(
      "open http://localhost:3000 as {{who}}",
    );
  });
});

describe("extractOutputs", () => {
  it("takes the named keys of a JSON object on stdout, stringifying non-strings", () => {
    expect(extractOutputs(["id", "count"], '{"id":"o-1","count":3,"other":true}\n')).toEqual({
      ok: true,
      values: { id: "o-1", count: "3" },
    });
  });

  it("takes the whole trimmed stdout for a single output that is not JSON", () => {
    expect(extractOutputs(["port"], "  3000\n")).toEqual({ ok: true, values: { port: "3000" } });
  });

  it("fails when a named key is missing", () => {
    expect(extractOutputs(["id", "token"], '{"id":"o-1"}')).toEqual({
      ok: false,
      error: "Output not found on stdout: token",
    });
  });
});

describe("editableFrom", () => {
  it("starts at the first step that has not passed or been skipped", () => {
    const steps = [
      step({ id: "a", status: "passed" }),
      step({ id: "b", status: "skipped" }),
      step({ id: "c", status: "failed" }),
      step({ id: "d" }),
    ];
    expect(editableFrom(steps)).toBe(2);
  });
});

describe("renderVerificationResults", () => {
  it("is empty when there is nothing recorded", () => {
    expect(renderVerificationResults([])).toBe("");
    expect(renderVerificationResults([scenario({ steps: [step({})] })])).toBe("");
  });

  it("lists answered and run steps with who answered, the verdict, criteria and note", () => {
    const md = renderVerificationResults([
      scenario({
        steps: [
          step({ id: "a", title: "API returns badge", status: "passed", result: { at: "2026-01-02T00:00:00.000Z", exitCode: 0 } }),
          step({
            id: "b",
            actor: "human",
            title: "Badge looks right",
            status: "passed",
            criteria: ["Unshipped orders show a red badge"],
            result: { at: "2026-01-02T00:01:00.000Z", note: "checked in Chrome" },
          }),
          step({ id: "c", actor: "human", title: "Admin view", status: "failed", result: { at: "2026-01-02T00:02:00.000Z", note: "badge missing" } }),
          step({ id: "d", title: "Not run yet" }),
        ],
      }),
    ]);
    expect(md).toContain("Orders list");
    expect(md).toContain("[claude] PASS — API returns badge");
    expect(md).toContain("[human] PASS — Badge looks right");
    expect(md).toContain("Unshipped orders show a red badge");
    expect(md).toContain("checked in Chrome");
    expect(md).toContain("[human] NG — Admin view");
    expect(md).not.toContain("Not run yet");
  });
});

describe("buildVerificationChatTopic", () => {
  it("carries the failed step's command, output, note and the variables", () => {
    const topic = buildVerificationChatTopic(
      scenario({
        status: "failed",
        variables: { port: "3000" },
        processes: [{ stepId: "a", pid: 1, command: "make dev", logFile: "/tmp/a.log", startedAt: "" }],
        steps: [
          step({ id: "a", title: "Start", status: "passed", command: "make dev", background: true }),
          step({ id: "b", title: "Call API", status: "failed", command: "curl -f localhost:{{port}}", result: { at: "", exitCode: 22, output: "HTTP 500" } }),
        ],
      }),
    );
    expect(topic).toContain("Call API");
    expect(topic).toContain("curl -f localhost:{{port}}");
    expect(topic).toContain("HTTP 500");
    expect(topic).toContain("port = 3000");
    expect(topic).toContain("make dev");
    expect(topic).toContain("/tmp/a.log");
  });
});
