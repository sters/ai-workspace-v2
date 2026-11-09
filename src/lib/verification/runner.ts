/**
 * Runs a verification scenario's steps in order, in this server process.
 *
 * Not an orchestrator operation: a scenario waits on people for as long as they
 * take, and a server restart must not lose it. The scenario file is the whole
 * state — the runner advances it one step at a time and stops on a human step,
 * a failure or the end. Nothing waits in memory for a human answer; the answer
 * starts the next run.
 *
 * Every command runs in its own process group so that stopping it stops what it
 * spawned too (`make dev` → node → workers). Background processes survive a
 * server restart by design, which is why they are recorded in the file.
 */

import path from "node:path";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { getCleanEnv } from "@/lib/env";
import { runProcess } from "@/lib/process/run";
import { editableFrom, expandCommand, extractOutputs } from "./model";
import { draftToStep, readScenario, scenarioLogDir, updateScenario } from "./store";
import type {
  VerificationProcess,
  VerificationScenario,
  VerificationStep,
  VerificationStepDraft,
  VerificationStepResult,
} from "@/types/verification";

/** Worktree directory name → absolute worktree path, for a step's `repo`. */
export type Worktrees = Record<string, string>;

type Outcome = { ok: true } | { ok: false; error: string };

const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 3 * 60 * 1000;
const READY_POLL_MS = 2000;
const READY_CHECK_TIMEOUT_MS = 30 * 1000;
/** A background step without a ready check passes when it is still up after this long. */
const SETTLE_MS = 3000;
const KILL_GRACE_MS = 5000;
const OUTPUT_TAIL_CHARS = 4000;

interface ActiveRun {
  controller: AbortController;
  done: Promise<void>;
}

const g = globalThis as unknown as {
  __aiwVerificationRuns?: Map<string, ActiveRun>;
  __aiwVerificationProcs?: Map<number, Bun.Subprocess>;
};
const active = (g.__aiwVerificationRuns ??= new Map());
/** Background processes this server process started, so their exit is observable. */
const procs = (g.__aiwVerificationProcs ??= new Map());

const key = (wsPath: string, id: string) => `${wsPath}\0${id}`;

export function isRunActive(wsPath: string, id: string): boolean {
  return active.has(key(wsPath, id));
}

/** Resolves when the scenario's current run, if any, has stopped. */
export async function waitForRun(wsPath: string, id: string): Promise<void> {
  await active.get(key(wsPath, id))?.done;
}

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL_CHARS ? text : `…${text.slice(-OUTPUT_TAIL_CHARS)}`;
}

function isGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killGroup(pid: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (isGroupAlive(pid) && Date.now() < deadline) await Bun.sleep(100);
  if (isGroupAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/**
 * Stop a recorded background process. One this server did not start (it was
 * started before a restart) is killed only when its pid still leads a process
 * group running the recorded command, so a recycled pid is left alone. This is
 * a heuristic: a recycled pid running an identical command would be killed too.
 */
async function stopProcess(p: VerificationProcess): Promise<void> {
  const own = procs.get(p.pid);
  if (own) {
    procs.delete(p.pid);
    if (own.exitCode === null && own.signalCode === null) await killGroup(p.pid);
    return;
  }
  const ps = await runProcess(["ps", "-o", "pgid=,command=", "-p", String(p.pid)]).catch(() => null);
  const line = ps?.stdout.trim() ?? "";
  const [pgid] = line.split(/\s+/, 1);
  const firstLine = p.command.split("\n")[0].slice(0, 40);
  if (pgid === String(p.pid) && line.includes(firstLine)) await killGroup(p.pid);
}

function cwdFor(step: VerificationStep, wsPath: string, worktrees: Worktrees): string | null {
  if (!step.repo) return wsPath;
  return worktrees[step.repo] ?? null;
}

async function runForeground(
  command: string,
  cwd: string,
  logFile: string,
  signal: AbortSignal,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<{ exitCode: number | null; stdout: string; output: string; durationMs: number }> {
  const start = Date.now();
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    env: getCleanEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  let stoppedBy: string | null = null;
  const stop = (why: string) => {
    stoppedBy = why;
    void killGroup(proc.pid);
  };
  const timer = setTimeout(() => stop(`timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs);
  const onAbort = () => stop("aborted");
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const combined = [stdout, stderr].filter((s) => s.trim()).join("\n") + (stoppedBy ? `\n(${stoppedBy})` : "");
    await appendFile(logFile, `$ ${command}\n${combined}\n`);
    return { exitCode: stoppedBy ? null : exitCode, stdout, output: tail(combined.trim()), durationMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readTail(file: string): Promise<string> {
  return tail((await readFile(file, "utf-8").catch(() => "")).trim());
}

/** Start a background step and wait for it to be ready. */
async function runBackground(
  step: VerificationStep,
  command: string,
  readyCommand: string | undefined,
  cwd: string,
  logFile: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; result: VerificationStepResult; process?: VerificationProcess }> {
  const start = Date.now();
  const handle = await open(logFile, "a");
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      env: getCleanEnv(),
      stdin: "ignore",
      stdout: handle.fd,
      stderr: handle.fd,
      detached: true,
    });
  } finally {
    await handle.close();
  }
  procs.set(proc.pid, proc);
  const record: VerificationProcess = {
    stepId: step.id,
    pid: proc.pid,
    command,
    logFile,
    startedAt: new Date().toISOString(),
  };
  const exited = () => proc.exitCode !== null || proc.signalCode !== null;
  const fail = async (note: string) => {
    await stopProcess(record);
    return {
      ok: false,
      result: { at: new Date().toISOString(), exitCode: proc.exitCode, output: await readTail(logFile), note, durationMs: Date.now() - start },
    };
  };

  if (!readyCommand) {
    await Bun.sleep(SETTLE_MS);
    if (signal.aborted) return fail("aborted");
    if (exited()) return fail("The process exited before it was ready");
  } else {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (signal.aborted) return fail("aborted");
      if (exited()) return fail("The process exited before it was ready");
      const check = await runForeground(readyCommand, cwd, logFile, signal, READY_CHECK_TIMEOUT_MS);
      if (check.exitCode === 0) break;
      if (Date.now() > deadline) return fail(`Not ready after ${READY_TIMEOUT_MS / 1000}s: ${readyCommand}`);
      await Bun.sleep(READY_POLL_MS);
    }
  }
  return {
    ok: true,
    result: { at: new Date().toISOString(), output: await readTail(logFile), durationMs: Date.now() - start },
    process: record,
  };
}

/** Run one Claude step against the scenario as it stands. Never throws for a step's own failure. */
async function runClaudeStep(
  wsPath: string,
  sc: VerificationScenario,
  step: VerificationStep,
  worktrees: Worktrees,
  signal: AbortSignal,
): Promise<{ ok: boolean; result: VerificationStepResult; values?: Record<string, string>; process?: VerificationProcess }> {
  const at = () => new Date().toISOString();
  const cwd = cwdFor(step, wsPath, worktrees);
  if (!cwd) return { ok: false, result: { at: at(), note: `No worktree named ${step.repo} in this workspace` } };
  const cmd = expandCommand(step.command ?? "", sc.variables);
  if (!cmd.ok) return { ok: false, result: { at: at(), note: cmd.error } };
  let ready: string | undefined;
  if (step.readyCommand) {
    const r = expandCommand(step.readyCommand, sc.variables);
    if (!r.ok) return { ok: false, result: { at: at(), note: r.error } };
    ready = r.command;
  }

  const logDir = scenarioLogDir(wsPath, sc.id);
  await mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `${step.id}.log`);

  if (step.background) return runBackground(step, cmd.command, ready, cwd, logFile, signal);

  const r = await runForeground(cmd.command, cwd, logFile, signal);
  const result: VerificationStepResult = { at: at(), exitCode: r.exitCode, output: r.output, durationMs: r.durationMs };
  if (r.exitCode !== 0) return { ok: false, result };
  if (step.outputs && step.outputs.length > 0) {
    const out = extractOutputs(step.outputs, r.stdout);
    if (!out.ok) return { ok: false, result: { ...result, note: out.error } };
    return { ok: true, result: { ...result, values: out.values }, values: out.values };
  }
  return { ok: true, result };
}

/** Run the pending teardown steps, then stop every background process. */
async function finish(wsPath: string, id: string, worktrees: Worktrees, status: "passed" | "aborted"): Promise<void> {
  const signal = new AbortController().signal;
  for (;;) {
    const sc = await readScenario(wsPath, id);
    const step = sc?.steps.find((s) => s.teardown && s.status === "pending");
    if (!sc || !step) break;
    const r = await runClaudeStep(wsPath, sc, step, worktrees, signal);
    await updateScenario(wsPath, id, (cur) => {
      const s = cur.steps.find((x) => x.id === step.id);
      if (s) Object.assign(s, { status: r.ok ? "passed" : "failed", result: r.result });
    });
  }
  const sc = await readScenario(wsPath, id);
  await Promise.all((sc?.processes ?? []).map(stopProcess));
  await updateScenario(wsPath, id, (cur) => {
    cur.processes = [];
    cur.status = status;
    for (const s of cur.steps) if (s.status === "pending" || s.status === "running" || s.status === "waiting") s.status = "skipped";
  });
}

async function advance(wsPath: string, id: string, worktrees: Worktrees, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) return;
    const sc = await readScenario(wsPath, id);
    if (!sc) return;
    const step = sc.steps.find((s) => !s.teardown && s.status === "pending");
    if (!step) {
      await finish(wsPath, id, worktrees, "passed");
      return;
    }
    if (step.actor === "human") {
      await updateScenario(wsPath, id, (cur) => {
        const s = cur.steps.find((x) => x.id === step.id);
        if (s) s.status = "waiting";
        cur.status = "waiting";
      });
      return;
    }

    await updateScenario(wsPath, id, (cur) => {
      const s = cur.steps.find((x) => x.id === step.id);
      if (s) s.status = "running";
      cur.status = "running";
    });
    const r = await runClaudeStep(wsPath, sc, step, worktrees, signal);
    if (signal.aborted && r.process) await stopProcess(r.process);
    await updateScenario(wsPath, id, (cur) => {
      const s = cur.steps.find((x) => x.id === step.id);
      if (s) Object.assign(s, { status: r.ok ? "passed" : "failed", result: r.result });
      if (r.values) Object.assign(cur.variables, r.values);
      if (r.process && !signal.aborted) cur.processes.push(r.process);
      if (!r.ok) cur.status = "failed";
    });
    if (!r.ok) return;
  }
}

/** Start advancing a scenario from its next pending step. Returns once the run has started. */
export async function startRun(wsPath: string, id: string, worktrees: Worktrees): Promise<Outcome> {
  const k = key(wsPath, id);
  if (active.has(k)) return { ok: false, error: "This scenario is already running" };
  const controller = new AbortController();
  let release!: () => void;
  const entry: ActiveRun = { controller, done: new Promise((r) => { release = r; }) };
  active.set(k, entry);
  try {
    await updateScenario(wsPath, id, (sc) => {
      sc.status = "running";
    });
  } catch (err) {
    active.delete(k);
    release();
    return { ok: false, error: String(err) };
  }
  void advance(wsPath, id, worktrees, controller.signal)
    .catch(async (err) => {
      await updateScenario(wsPath, id, (sc) => {
        const s = sc.steps.find((x) => x.status === "running");
        if (s) Object.assign(s, { status: "failed", result: { at: new Date().toISOString(), note: String(err) } });
        sc.status = "failed";
      }).catch(() => {});
    })
    .finally(() => {
      active.delete(k);
      release();
    });
  return { ok: true };
}

function idle(wsPath: string, id: string): Outcome | null {
  return isRunActive(wsPath, id) ? { ok: false, error: "This scenario is running; abort it first" } : null;
}

export async function answerStep(
  wsPath: string,
  id: string,
  worktrees: Worktrees,
  answer: { stepId: string; verdict: "ok" | "ng"; note?: string; values?: Record<string, string> },
): Promise<Outcome> {
  const busy = idle(wsPath, id);
  if (busy) return busy;
  const outcome = await updateScenario(wsPath, id, (sc): Outcome => {
    const step = sc.steps.find((s) => s.id === answer.stepId);
    if (!step || step.status !== "waiting") return { ok: false, error: "That step is not waiting for an answer" };
    const values: Record<string, string> = {};
    for (const input of step.inputs ?? []) {
      const v = answer.values?.[input.name]?.trim() ?? "";
      if (answer.verdict === "ok" && !v) return { ok: false, error: `${input.label} is required` };
      if (v && input.options && !input.options.includes(v)) {
        return { ok: false, error: `${input.label} must be one of: ${input.options.join(", ")}` };
      }
      if (v) values[input.name] = v;
    }
    step.status = answer.verdict === "ok" ? "passed" : "failed";
    step.result = {
      at: new Date().toISOString(),
      ...(answer.note?.trim() && { note: answer.note.trim() }),
      ...(Object.keys(values).length > 0 && { values }),
    };
    Object.assign(sc.variables, values);
    sc.status = answer.verdict === "ok" ? "ready" : "failed";
    return { ok: true };
  });
  if (!outcome.ok || answer.verdict === "ng") return outcome;
  return startRun(wsPath, id, worktrees);
}

export async function rerunFrom(wsPath: string, id: string, worktrees: Worktrees, stepId: string): Promise<Outcome> {
  const busy = idle(wsPath, id);
  if (busy) return busy;
  const outcome = await updateScenario(wsPath, id, (sc): Outcome => {
    const i = sc.steps.findIndex((s) => s.id === stepId);
    if (i === -1) return { ok: false, error: "No such step" };
    for (const s of sc.steps.slice(i)) {
      s.status = "pending";
      delete s.result;
    }
    for (const s of sc.steps) if (s.teardown) {
      s.status = "pending";
      delete s.result;
    }
    sc.status = "ready";
    return { ok: true };
  });
  return outcome.ok ? startRun(wsPath, id, worktrees) : outcome;
}

export async function skipStep(wsPath: string, id: string, worktrees: Worktrees, stepId: string): Promise<Outcome> {
  const busy = idle(wsPath, id);
  if (busy) return busy;
  const outcome = await updateScenario(wsPath, id, (sc): Outcome => {
    const step = sc.steps.find((s) => s.id === stepId);
    if (!step || (step.status !== "failed" && step.status !== "waiting")) {
      return { ok: false, error: "Only a failed or waiting step can be skipped" };
    }
    step.status = "skipped";
    sc.status = "ready";
    return { ok: true };
  });
  return outcome.ok ? startRun(wsPath, id, worktrees) : outcome;
}

/**
 * Replace every step from the first unfinished one on. The steps already done
 * keep their results; the replacements start pending at `revision`.
 */
export async function replaceRemainingSteps(
  wsPath: string,
  id: string,
  drafts: VerificationStepDraft[],
  revision?: number,
): Promise<Outcome> {
  const busy = idle(wsPath, id);
  if (busy) return busy;
  return updateScenario(wsPath, id, (sc): Outcome => {
    if (revision !== undefined) sc.revision = revision;
    const keep = sc.steps.slice(0, editableFrom(sc.steps));
    sc.steps = [...keep, ...drafts.map((d) => draftToStep(d, sc.revision))];
    if (sc.status !== "passed" && sc.status !== "aborted") sc.status = "ready";
    return { ok: true };
  });
}

export function editSteps(wsPath: string, id: string, drafts: VerificationStepDraft[]): Promise<Outcome> {
  return replaceRemainingSteps(wsPath, id, drafts);
}

/** Stop a run in progress, run teardown, and stop the background processes. */
export async function abortScenario(wsPath: string, id: string, worktrees: Worktrees = {}): Promise<void> {
  const run = active.get(key(wsPath, id));
  if (run) {
    run.controller.abort();
    await run.done;
  }
  const sc = await readScenario(wsPath, id);
  if (!sc || ((sc.status === "passed" || sc.status === "aborted") && sc.processes.length === 0)) return;
  await finish(wsPath, id, worktrees, "aborted");
}

/**
 * A scenario recorded as running with no run in this process was cut off by a
 * restart: its running step is marked failed so it can be rerun or skipped.
 */
export async function reconcileInterrupted(
  wsPath: string,
  scenarios: VerificationScenario[],
): Promise<VerificationScenario[]> {
  return Promise.all(scenarios.map(async (sc) => {
    if (sc.status !== "running" || isRunActive(wsPath, sc.id)) return sc;
    await updateScenario(wsPath, sc.id, (cur) => {
      if (cur.status !== "running") return;
      for (const s of cur.steps) if (s.status === "running") {
        s.status = "failed";
        s.result = { at: new Date().toISOString(), note: "Interrupted: the server stopped while this step ran" };
      }
      cur.status = "failed";
    });
    return (await readScenario(wsPath, sc.id)) ?? sc;
  }));
}
