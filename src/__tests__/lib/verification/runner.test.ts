import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createScenarios, readScenario, updateScenario } from "@/lib/verification/store";
import {
  abortScenario,
  answerStep,
  editSteps,
  reconcileInterrupted,
  rerunFrom,
  skipStep,
  startRun,
  waitForRun,
} from "@/lib/verification/runner";
import type { VerificationStepDraft } from "@/types/verification";

let wsPath: string;

beforeEach(async () => {
  wsPath = await mkdtemp(path.join(os.tmpdir(), "aiw-verify-"));
});

afterEach(async () => {
  await rm(wsPath, { recursive: true, force: true });
});

async function create(steps: VerificationStepDraft[]) {
  const [sc] = await createScenarios(wsPath, [{ title: "Orders", summary: "", steps }]);
  return sc.id;
}

async function run(id: string) {
  const started = await startRun(wsPath, id, {});
  expect(started).toEqual({ ok: true });
  await waitForRun(wsPath, id);
  return (await readScenario(wsPath, id))!;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("verification runner", () => {
  it("runs command steps in order, stops on a human step, and carries its answer into later commands", async () => {
    const marker = path.join(wsPath, "teardown-ran");
    const id = await create([
      { title: "Seed", actor: "command", command: `echo '{"order_id":"o-1"}'`, outputs: ["order_id"] },
      {
        title: "Pick a role",
        actor: "human",
        instructions: "Open order {{order_id}}",
        inputs: [{ name: "role", label: "Role", options: ["admin", "member"] }],
      },
      { title: "Check", actor: "command", command: `test {{order_id}} = o-1 && test {{role}} = admin` },
      { title: "Clean up", actor: "command", command: `touch ${marker}`, teardown: true },
    ]);

    let sc = await run(id);
    expect(sc.status).toBe("waiting");
    expect(sc.variables).toEqual({ order_id: "o-1" });
    expect(sc.steps.map((s) => s.status)).toEqual(["passed", "waiting", "pending", "pending"]);

    const waitingId = sc.steps[1].id;
    expect(await answerStep(wsPath, id, {}, { stepId: waitingId, verdict: "ok", values: { role: "guest" } })).toMatchObject({ ok: false });

    expect(await answerStep(wsPath, id, {}, { stepId: waitingId, verdict: "ok", values: { role: "admin" }, note: "looks fine" })).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("passed");
    expect(sc.steps.map((s) => s.status)).toEqual(["passed", "passed", "passed", "passed"]);
    expect(sc.steps[1].result?.note).toBe("looks fine");
    await expect(readFile(marker, "utf-8")).resolves.toBe("");
  });

  it("stops on a failing command and continues from it once the step is edited and rerun", async () => {
    const id = await create([
      { title: "Ok", actor: "command", command: "true" },
      { title: "Broken", actor: "command", command: "echo boom >&2; exit 3" },
      { title: "After", actor: "command", command: "true" },
    ]);

    let sc = await run(id);
    expect(sc.status).toBe("failed");
    expect(sc.steps[1]).toMatchObject({ status: "failed", result: { exitCode: 3 } });
    expect(sc.steps[1].result?.output).toContain("boom");
    expect(sc.steps[2].status).toBe("pending");

    expect(await editSteps(wsPath, id, [
      { title: "Fixed", actor: "command", command: "true" },
      { title: "After", actor: "command", command: "true" },
    ])).toEqual({ ok: true });
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("ready");
    expect(sc.steps.map((s) => [s.title, s.status])).toEqual([["Ok", "passed"], ["Fixed", "pending"], ["After", "pending"]]);

    sc = await run(id);
    expect(sc.status).toBe("passed");

    expect(await rerunFrom(wsPath, id, {}, sc.steps[1].id)).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.steps.map((s) => s.status)).toEqual(["passed", "passed", "passed"]);
  });

  it("gives every step the workspace variables passed to a run, refreshed on each run", async () => {
    const id = await create([
      { title: "Look up the PR", actor: "command", command: "test {{pr_widgets}} = 43" },
    ]);
    expect(await startRun(wsPath, id, {}, { pr_widgets: "42" })).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    let sc = (await readScenario(wsPath, id))!;
    expect(sc.steps[0].status).toBe("failed");

    expect(await rerunFrom(wsPath, id, {}, sc.steps[0].id, { pr_widgets: "43" })).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.steps[0].status).toBe("passed");
    expect(sc.variables.pr_widgets).toBe("43");
  });

  it("fails a step whose command names a variable nobody set, without running it", async () => {
    const id = await create([{ title: "Call", actor: "command", command: "curl /orders/{{order_id}}" }]);
    const sc = await run(id);
    expect(sc.steps[0]).toMatchObject({ status: "failed", result: { note: "Unknown variable: order_id" } });
  });

  it("skips a step answered NG and goes on", async () => {
    const id = await create([
      { title: "Look", actor: "human", instructions: "Look at it" },
      { title: "After", actor: "command", command: "true" },
    ]);
    let sc = await run(id);
    const look = sc.steps[0].id;
    expect(await answerStep(wsPath, id, {}, { stepId: look, verdict: "ng", note: "badge missing" })).toEqual({ ok: true });
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("failed");
    expect(sc.steps[0]).toMatchObject({ status: "failed", result: { note: "badge missing" } });

    expect(await skipStep(wsPath, id, {}, look)).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("passed");
    expect(sc.steps.map((s) => s.status)).toEqual(["skipped", "passed"]);
  });

  it("keeps a background process up across a human step and stops its whole process group on abort", async () => {
    const id = await create([
      { title: "Serve", actor: "command", command: "sleep 60 & sleep 60", background: true, readyCommand: "true" },
      { title: "Look", actor: "human", instructions: "Look at it" },
    ]);
    let sc = await run(id);
    expect(sc.status).toBe("waiting");
    expect(sc.processes).toHaveLength(1);
    const pid = sc.processes[0].pid;
    expect(alive(pid)).toBe(true);

    await abortScenario(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("aborted");
    expect(sc.processes).toEqual([]);
    expect(alive(pid)).toBe(false);
    expect(() => process.kill(-pid, 0)).toThrow();
  });

  it("stops the background processes of the steps a rerun repeats, and keeps the earlier ones", async () => {
    const id = await create([
      { title: "Serve", actor: "command", command: "sleep 60", background: true, readyCommand: "true" },
      { title: "Forward", actor: "command", command: "sleep 60", background: true, readyCommand: "true" },
      { title: "Look", actor: "human", instructions: "Look at it" },
    ]);
    let sc = await run(id);
    const [serve, forward] = sc.processes.map((p) => p.pid);

    expect(await rerunFrom(wsPath, id, {}, sc.steps[1].id)).toEqual({ ok: true });
    await waitForRun(wsPath, id);
    sc = (await readScenario(wsPath, id))!;
    expect(sc.status).toBe("waiting");
    expect(alive(serve)).toBe(true);
    expect(alive(forward)).toBe(false);
    expect(sc.processes).toHaveLength(2);
    expect(sc.processes[0].pid).toBe(serve);
    expect(alive(sc.processes[1].pid)).toBe(true);

    await abortScenario(wsPath, id);
  });

  it("fails a background step whose process exits before it is ready", async () => {
    const id = await create([
      { title: "Serve", actor: "command", command: "echo cannot bind; exit 1", background: true, readyCommand: "false" },
    ]);
    const sc = await run(id);
    expect(sc.steps[0].status).toBe("failed");
    expect(sc.steps[0].result?.output).toContain("cannot bind");
    expect(sc.processes).toEqual([]);
  });

  it("refuses a second run while one is in progress", async () => {
    const id = await create([{ title: "Slow", actor: "command", command: "sleep 1" }]);
    expect(await startRun(wsPath, id, {})).toEqual({ ok: true });
    expect(await startRun(wsPath, id, {})).toMatchObject({ ok: false });
    await waitForRun(wsPath, id);
  });

  it("marks a scenario left running by a previous server process as interrupted", async () => {
    const id = await create([{ title: "Slow", actor: "command", command: "true" }]);
    await updateScenario(wsPath, id, (sc) => {
      sc.status = "running";
      sc.steps[0].status = "running";
    });
    const [sc] = await reconcileInterrupted(wsPath, [(await readScenario(wsPath, id))!]);
    expect(sc.status).toBe("failed");
    expect(sc.steps[0].status).toBe("failed");
    expect(sc.steps[0].result?.note).toMatch(/interrupted/i);
  });
});
