/**
 * The workspace's PR-comment validation store (`artifacts/pr-validations.json`).
 *
 * A validation is what the tab's **validate** button produces: an agent's read
 * of one review comment against the code, for the case where a human cannot tell
 * what the reviewer is asking for. It is persisted rather than left in the
 * operation log because the point of validating is to decide afterwards — the
 * verdict has to survive a reload and be readable by the triage that may follow
 * it (the validate → triage route).
 *
 * One file rather than one file per thread: every write comes from the parent
 * function phase, which serializes them, so the whole-file rewrite cannot race,
 * and the tab needs all verdicts at once anyway.
 */

import path from "node:path";
import type {
  PrThreadValidation,
  PrThreadVerdict,
  PrValidationStore,
} from "@/types/pull-request";

const VERDICTS: readonly PrThreadVerdict[] = ["valid", "invalid", "unclear"];

export function getPrValidationsPath(wsPath: string): string {
  return path.join(wsPath, "artifacts", "pr-validations.json");
}

/**
 * Coerce a verdict to one this codebase knows.
 *
 * Unknown falls to `unclear` because that is the only reading that keeps the
 * thread in front of a human: guessing `valid` would send work to an executor on
 * an unparsed verdict, and guessing `invalid` would quietly retire a real ask.
 */
export function normalizeVerdict(verdict: string | undefined): PrThreadVerdict {
  return VERDICTS.find((v) => v === verdict) ?? "unclear";
}

function normalizeEntry(threadId: string, raw: unknown): PrThreadValidation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  // A key that disagrees with the stored id means the file was hand-edited or
  // written by an older shape — attaching that verdict to this key would show
  // one thread's judgment under another's comment.
  if (entry.threadId !== threadId) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    threadId,
    repoName: str(entry.repoName),
    commentUrl: str(entry.commentUrl),
    verdict: normalizeVerdict(typeof entry.verdict === "string" ? entry.verdict : undefined),
    interpretation: str(entry.interpretation),
    reasoning: str(entry.reasoning),
    recommendation: str(entry.recommendation),
    evidence: Array.isArray(entry.evidence)
      ? entry.evidence.filter((e): e is string => typeof e === "string")
      : [],
    validatedAt: str(entry.validatedAt),
  };
}

/** Parse stored JSON. Anything unreadable yields an empty store, never a throw. */
export function parseValidationStore(raw: string): PrValidationStore {
  const empty: PrValidationStore = { version: 1, validations: {} };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return empty;

  const stored = (json as { validations?: unknown }).validations;
  if (typeof stored !== "object" || stored === null) return empty;

  const validations: Record<string, PrThreadValidation> = {};
  for (const [threadId, entry] of Object.entries(stored as Record<string, unknown>)) {
    const normalized = normalizeEntry(threadId, entry);
    if (normalized) validations[threadId] = normalized;
  }
  return { version: 1, validations };
}

/**
 * Fold new verdicts into a store. Re-validating a thread replaces its verdict —
 * the newer read of the code is the better one — while threads the run was not
 * asked about are left alone.
 */
export function mergeValidations(
  store: PrValidationStore | undefined,
  fresh: PrThreadValidation[],
): PrValidationStore {
  const validations = { ...(store?.validations ?? {}) };
  for (const entry of fresh) {
    if (!entry.threadId) continue;
    validations[entry.threadId] = entry;
  }
  return { version: 1, validations };
}

export async function readPrValidations(wsPath: string): Promise<PrValidationStore> {
  const file = Bun.file(getPrValidationsPath(wsPath));
  try {
    if (!(await file.exists())) return { version: 1, validations: {} };
    return parseValidationStore(await file.text());
  } catch {
    return { version: 1, validations: {} };
  }
}

/** Merge verdicts into the workspace's store and persist. Returns the new store. */
export async function writePrValidations(
  wsPath: string,
  fresh: PrThreadValidation[],
): Promise<PrValidationStore> {
  const merged = mergeValidations(await readPrValidations(wsPath), fresh);
  await Bun.write(getPrValidationsPath(wsPath), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

