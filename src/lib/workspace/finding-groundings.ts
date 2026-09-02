/**
 * The workspace's grounding store (`artifacts/finding-groundings.json`).
 *
 * A grounding is what the **Post findings** operation produces per selected
 * finding: an agent's check of the reviewer's claim against the pushed code, and
 * the comment it wrote if the claim earned one. It is persisted because the
 * operation's decision outlives the operation — a later visit to the review tab
 * has to show which findings were dropped and why rather than offering them
 * again as though nothing had happened.
 *
 * One file rather than one per finding: every write comes from the single
 * function phase that collects the children's output, so the whole-file rewrite
 * cannot race.
 */

import path from "node:path";
import type {
  FindingGrounding,
  FindingGroundingStore,
  GroundingScope,
  GroundingVerdict,
} from "@/types/review-findings";

const VERDICTS: readonly GroundingVerdict[] = ["yes", "no", "unclear"];
const SCOPES: readonly GroundingScope[] = ["pr", "local-only", "pre-existing"];

export function getGroundingsPath(wsPath: string): string {
  return path.join(wsPath, "artifacts", "finding-groundings.json");
}

/**
 * Coerce a verdict to one this codebase knows.
 *
 * Unknown falls to `unclear`, and unknown scope to `pre-existing`, because both
 * are values that **do not post**. An unparsed field must never be the thing
 * that puts a comment on someone else's pull request.
 */
export function normalizeHolds(holds: string | undefined): GroundingVerdict {
  return VERDICTS.find((v) => v === holds) ?? "unclear";
}

export function normalizeScope(scope: string | undefined): GroundingScope {
  return SCOPES.find((s) => s === scope) ?? "pre-existing";
}

/**
 * Whether this grounding earns a comment on the PR.
 *
 * Both axes have to clear: the claim has to survive the code (`yes`), and the
 * problem has to belong to this PR (`pr`). A confirmed defect that predates the
 * branch or only reproduces locally is real and still not this PR's business.
 */
export function shouldPost(grounding: FindingGrounding): boolean {
  return (
    grounding.holds === "yes" &&
    grounding.scope === "pr" &&
    grounding.comment.trim() !== ""
  );
}

function normalizeEntry(findingId: string, raw: unknown): FindingGrounding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  // A key that disagrees with the stored id means a hand edit or an older shape;
  // attaching that verdict to this key would show one finding's judgment under
  // another's row.
  if (entry.findingId !== findingId) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    findingId,
    repoName: str(entry.repoName),
    holds: normalizeHolds(typeof entry.holds === "string" ? entry.holds : undefined),
    scope: normalizeScope(typeof entry.scope === "string" ? entry.scope : undefined),
    evidence: Array.isArray(entry.evidence)
      ? entry.evidence.filter((e): e is string => typeof e === "string")
      : [],
    comment: str(entry.comment),
    reason: str(entry.reason),
    posted: entry.posted === true,
    groundedAt: str(entry.groundedAt),
  };
}

/** Parse stored JSON. Anything unreadable yields an empty store, never a throw. */
export function parseGroundingStore(raw: string): FindingGroundingStore {
  const empty: FindingGroundingStore = { version: 1, groundings: {} };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return empty;

  const stored = (json as { groundings?: unknown }).groundings;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return empty;

  const groundings: Record<string, FindingGrounding> = {};
  for (const [findingId, entry] of Object.entries(stored as Record<string, unknown>)) {
    const normalized = normalizeEntry(findingId, entry);
    if (normalized) groundings[findingId] = normalized;
  }
  return { version: 1, groundings };
}

/**
 * Fold fresh verdicts into a store. Re-grounding a finding replaces its verdict —
 * the newer read of the code is the better one — while findings the run was not
 * asked about are left alone.
 */
export function mergeGroundings(
  store: FindingGroundingStore | undefined,
  fresh: FindingGrounding[],
): FindingGroundingStore {
  const groundings = { ...(store?.groundings ?? {}) };
  for (const entry of fresh) {
    if (!entry.findingId) continue;
    groundings[entry.findingId] = entry;
  }
  return { version: 1, groundings };
}

export async function readFindingGroundings(
  wsPath: string,
): Promise<FindingGroundingStore> {
  const file = Bun.file(getGroundingsPath(wsPath));
  try {
    if (!(await file.exists())) return { version: 1, groundings: {} };
    return parseGroundingStore(await file.text());
  } catch {
    return { version: 1, groundings: {} };
  }
}

/** Merge verdicts into the workspace's store and persist. Returns the new store. */
export async function writeFindingGroundings(
  wsPath: string,
  fresh: FindingGrounding[],
): Promise<FindingGroundingStore> {
  const merged = mergeGroundings(await readFindingGroundings(wsPath), fresh);
  await Bun.write(getGroundingsPath(wsPath), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}
