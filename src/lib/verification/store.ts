/**
 * Verification scenarios on disk: `artifacts/verification/<id>.json`, with each
 * scenario's command logs in `artifacts/verification/<id>/`. Kept with the
 * workspace rather than in the database so it is archived and deleted with it,
 * and readable by any agent working in the workspace.
 *
 * Every write goes through `updateScenario`, which serializes writes per file —
 * the runner and the Verify tab's requests both write while a scenario runs.
 */

import path from "node:path";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { pathExists } from "@/lib/fs";
import { verificationScenarioSchema } from "@/lib/runtime-schemas";
import { renderVerificationResults } from "./model";
import type {
  VerificationScenario,
  VerificationStep,
  VerificationStepDraft,
} from "@/types/verification";

export const SCENARIO_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function verificationDir(wsPath: string): string {
  return path.join(wsPath, "artifacts", "verification");
}

export function scenarioLogDir(wsPath: string, id: string): string {
  return path.join(verificationDir(wsPath), id);
}

function scenarioFile(wsPath: string, id: string): string {
  if (!SCENARIO_ID.test(id)) throw new Error(`Invalid scenario id: ${id}`);
  return path.join(verificationDir(wsPath), `${id}.json`);
}

async function parseFile(file: string): Promise<VerificationScenario | null> {
  try {
    const parsed = verificationScenarioSchema.safeParse(JSON.parse(await readFile(file, "utf-8")));
    return parsed.success ? (parsed.data as VerificationScenario) : null;
  } catch {
    return null;
  }
}

export async function readScenario(wsPath: string, id: string): Promise<VerificationScenario | null> {
  return parseFile(scenarioFile(wsPath, id));
}

/** Every readable scenario, oldest first. A file that does not parse is left out. */
export async function listScenarios(wsPath: string): Promise<VerificationScenario[]> {
  const dir = verificationDir(wsPath);
  if (!(await pathExists(dir))) return [];
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  const all = await Promise.all(names.map((n) => parseFile(path.join(dir, n))));
  return all
    .filter((s): s is VerificationScenario => s !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function writeScenario(wsPath: string, sc: VerificationScenario): Promise<void> {
  const file = scenarioFile(wsPath, sc.id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sc, null, 2)}\n`);
  await rename(tmp, file);
}

const g = globalThis as unknown as { __aiwVerificationLocks?: Map<string, Promise<unknown>> };
const locks = (g.__aiwVerificationLocks ??= new Map());

/**
 * Read, change and write one scenario under its lock. `fn` mutates the scenario
 * in place; its return value is passed through. Throws when the scenario does
 * not exist.
 */
export async function updateScenario<T>(
  wsPath: string,
  id: string,
  fn: (sc: VerificationScenario) => T | Promise<T>,
): Promise<T> {
  const file = scenarioFile(wsPath, id);
  const prev = locks.get(file) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const sc = await parseFile(file);
    if (!sc) throw new Error(`Scenario not found: ${id}`);
    const out = await fn(sc);
    sc.updatedAt = new Date().toISOString();
    await writeScenario(wsPath, sc);
    return out;
  });
  locks.set(file, run);
  try {
    return await run;
  } finally {
    if (locks.get(file) === run) locks.delete(file);
  }
}

function newStepId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function draftToStep(draft: VerificationStepDraft, revision: number): VerificationStep {
  return { ...draft, id: newStepId(), status: "pending", revision };
}

function slug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "scenario";
}

export async function createScenarios(
  wsPath: string,
  drafts: { title: string; summary: string; steps: VerificationStepDraft[] }[],
): Promise<VerificationScenario[]> {
  const created: VerificationScenario[] = [];
  for (const d of drafts) {
    const now = new Date().toISOString();
    const sc: VerificationScenario = {
      id: `${slug(d.title)}-${crypto.randomUUID().slice(0, 6)}`,
      title: d.title,
      summary: d.summary,
      status: "ready",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      variables: {},
      steps: d.steps.map((s) => draftToStep(s, 0)),
      processes: [],
    };
    await writeScenario(wsPath, sc);
    created.push(sc);
  }
  return created;
}

export async function deleteScenarioFiles(wsPath: string, id: string): Promise<void> {
  await rm(scenarioFile(wsPath, id), { force: true });
  await rm(scenarioLogDir(wsPath, id), { recursive: true, force: true });
}

/** `renderVerificationResults` over the workspace's scenarios; "" when there are none. */
export async function readVerificationResults(wsPath: string): Promise<string> {
  return renderVerificationResults(await listScenarios(wsPath));
}
