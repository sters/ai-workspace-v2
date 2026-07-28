/**
 * The workspace's known-findings ledger (`artifacts/known-findings.md`).
 *
 * Without it, every autonomous cycle re-derives and re-reports the same
 * findings no cycle can clear — an acceptance criterion the contract cannot
 * satisfy, an escalation another team owns, a pre-existing tooling failure —
 * because the review agents have no memory across cycles and the gate only
 * receives its own past `reason`/`fixableIssues` strings.
 *
 * The gate records each finding it deliberately did not act on here. Later
 * cycles' reviewers read the file and compress recurrences to one line, and the
 * gate reads it so it does not re-litigate a decision it already made.
 */

import path from "node:path";

export const KNOWN_FINDING_KINDS = [
  /** Excluded by the README's `## Non-Goal` — no cycle will ever act on it. */
  "out-of-scope",
  /** Needs a human answer or manual verification; not a code change. */
  "pending-human",
  /** No change within this workspace's repos can satisfy it. */
  "infeasible",
  /** Environment/tooling failure that predates the change. */
  "pre-existing",
  /** Reported as a suspicion the gate declined to chase. */
  "low-confidence",
  /** Real and actionable, but deliberately not done in this run. */
  "deferred",
] as const;

export type KnownFindingKind = (typeof KNOWN_FINDING_KINDS)[number];

export interface KnownFinding {
  /** One-line description of the finding as the review reported it. */
  summary: string;
  /** Why it was not acted on. */
  reason: string;
  kind: KnownFindingKind;
  /** Autonomous cycle that made the call, when known. */
  cycle?: number;
}

export const KNOWN_FINDINGS_HEADING = "# Known / Accepted Findings";

const HEADER = `${KNOWN_FINDINGS_HEADING}

Findings that an earlier cycle evaluated and deliberately did NOT act on, with
the reason. Reviewers read this file to compress recurrences to one line instead
of re-deriving them, and the autonomous gate reads it so it does not loop on a
decision it already made.

Entries are cumulative — remove one only when the underlying decision changes.
`;

/** `- **[kind]** (cycle N) summary` + a `Why not acted on:` sub-bullet. */
const ENTRY_PATTERN = /^-\s+\*\*\[[a-z-]+\]\*\*\s*(?:\(cycle \d+\)\s*)?(.+)$/gm;

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Dedup key: the summary reduced to lowercase alphanumerics. Two cycles rarely
 * word a recurring finding identically — backticks, trailing periods and
 * capitalization all drift — so anything but the letters is noise here.
 */
function dedupKey(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeKnownFindingKind(kind: string | undefined): KnownFindingKind {
  const known = KNOWN_FINDING_KINDS.find((k) => k === kind);
  // Fall back to the weakest claim: "deferred" only says "not acted on", while
  // guessing e.g. "out-of-scope" would assert the finding is permanently dead.
  return known ?? "deferred";
}

export function getKnownFindingsPath(wsPath: string): string {
  return path.join(wsPath, "artifacts", "known-findings.md");
}

export function renderKnownFinding(finding: KnownFinding): string {
  const cycle = finding.cycle ? ` (cycle ${finding.cycle})` : "";
  const reason = oneLine(finding.reason) || "no reason recorded";
  return `- **[${finding.kind}]**${cycle} ${oneLine(finding.summary)}\n  - Why not acted on: ${reason}`;
}

export function parseKnownFindingSummaries(content: string): string[] {
  const summaries: string[] = [];
  ENTRY_PATTERN.lastIndex = 0;
  let match;
  while ((match = ENTRY_PATTERN.exec(content)) !== null) {
    const summary = match[1].trim();
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/** Ledger content, or `""` when the workspace has no ledger yet. */
export async function readKnownFindings(wsPath: string): Promise<string> {
  const file = Bun.file(getKnownFindingsPath(wsPath));
  try {
    if (!(await file.exists())) return "";
    return await file.text();
  } catch {
    return "";
  }
}

/**
 * Append findings not already recorded. Returns the entries actually added, so
 * callers can report the count without re-reading the file.
 */
export async function appendKnownFindings(
  wsPath: string,
  findings: KnownFinding[],
): Promise<KnownFinding[]> {
  const existingContent = await readKnownFindings(wsPath);
  const seen = new Set(parseKnownFindingSummaries(existingContent).map(dedupKey));

  const fresh: KnownFinding[] = [];
  for (const finding of findings) {
    const summary = oneLine(finding.summary);
    if (!summary) continue;
    const key = dedupKey(summary);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...finding, summary });
  }

  if (fresh.length === 0) return [];

  const body = fresh.map(renderKnownFinding).join("\n");
  const base = existingContent.trim() === "" ? HEADER : `${existingContent.trimEnd()}\n`;
  await Bun.write(getKnownFindingsPath(wsPath), `${base}\n${body}\n`);
  return fresh;
}
