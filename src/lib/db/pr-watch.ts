import { getDb } from "./connection";
import type { WatchState } from "@/lib/pr-watcher/scheduler";
import type { PrEvent, PrEventInput, PrWatchSnapshot, PrCiState, PrEventKind } from "@/types/pr-watch";

interface SnapshotRow {
  workspace: string;
  repo_name: string;
  pr_url: string;
  state: string;
  head_sha: string;
  ci: string;
  mergeable: string;
  seen_comments: string;
  settled_comments: string;
}

export function getPrSnapshot(workspace: string, repoName: string): PrWatchSnapshot | null {
  const row = getDb()
    .query("SELECT * FROM pr_watch WHERE workspace = ? AND repo_name = ?")
    .get(workspace, repoName) as SnapshotRow | null;
  return row ? toSnapshot(row) : null;
}

export function listPrSnapshots(workspace: string): PrWatchSnapshot[] {
  const rows = getDb().query("SELECT * FROM pr_watch WHERE workspace = ? ORDER BY repo_name").all(workspace) as SnapshotRow[];
  return rows.map(toSnapshot);
}

export function getPrHandledAt(workspace: string): string | null {
  const row = getDb().query("SELECT handled_at FROM pr_handled WHERE workspace = ?").get(workspace) as
    | { handled_at: string }
    | null;
  return row?.handled_at ?? null;
}

export function markPrHandled(workspace: string, at: string = new Date().toISOString()): void {
  getDb().query("INSERT OR REPLACE INTO pr_handled (workspace, handled_at) VALUES (?, ?)").run(workspace, at);
}

function stringList(json: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

function toSnapshot(row: SnapshotRow): PrWatchSnapshot {
  return {
    workspace: row.workspace,
    repoName: row.repo_name,
    prUrl: row.pr_url,
    state: row.state,
    headSha: row.head_sha,
    ci: row.ci as PrCiState,
    mergeable: row.mergeable,
    seenComments: stringList(row.seen_comments),
    settledComments: stringList(row.settled_comments),
  };
}

/** Replace the snapshot and append its events in one transaction, so a crash cannot record one without the other. */
export function savePrObservation(snapshot: PrWatchSnapshot, events: PrEventInput[]): void {
  const db = getDb();
  db.transaction(() => {
    db.query(
      `INSERT OR REPLACE INTO pr_watch (workspace, repo_name, pr_url, state, head_sha, ci, mergeable, seen_comments, settled_comments, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).run(
      snapshot.workspace,
      snapshot.repoName,
      snapshot.prUrl,
      snapshot.state,
      snapshot.headSha,
      snapshot.ci,
      snapshot.mergeable,
      JSON.stringify(snapshot.seenComments),
      JSON.stringify(snapshot.settledComments),
    );
    const insert = db.query(
      `INSERT INTO pr_events (workspace, repo_name, pr_url, kind, author, body, url, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of events) {
      insert.run(e.workspace, e.repoName, e.prUrl, e.kind, e.author, e.body, e.url, e.occurredAt);
    }
  })();
}

interface EventRow {
  id: number;
  workspace: string;
  repo_name: string;
  pr_url: string;
  kind: string;
  author: string | null;
  body: string;
  url: string | null;
  occurred_at: string;
}

export function listPrEvents(workspace: string): PrEvent[] {
  const rows = getDb()
    .query("SELECT * FROM pr_events WHERE workspace = ? ORDER BY occurred_at, id")
    .all(workspace) as EventRow[];
  return rows.map((r) => ({
    id: r.id,
    workspace: r.workspace,
    repoName: r.repo_name,
    prUrl: r.pr_url,
    kind: r.kind as PrEventKind,
    author: r.author,
    body: r.body,
    url: r.url,
    occurredAt: r.occurred_at,
  }));
}

export interface TriageVerdict {
  url: string;
  verdict: "addressed" | "open";
  reason: string;
}

export function saveTriageVerdicts(workspace: string, verdicts: TriageVerdict[]): void {
  const db = getDb();
  const upsert = db.query(
    `INSERT OR REPLACE INTO pr_triage_verdicts (workspace, comment_url, verdict, reason, judged_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  );
  db.transaction(() => {
    for (const v of verdicts) upsert.run(workspace, v.url, v.verdict, v.reason);
  })();
}

export function listAddressedTriageComments(workspace: string): string[] {
  const rows = getDb()
    .query("SELECT comment_url FROM pr_triage_verdicts WHERE workspace = ? AND verdict = 'addressed'")
    .all(workspace) as { comment_url: string }[];
  return rows.map((r) => r.comment_url);
}

/** The PR watcher's schedule as the last pass left it; null before the first pass. */
export function loadWatchState(): WatchState | null {
  const row = getDb().query("SELECT state FROM pr_watch_state WHERE id = 1").get() as { state: string } | null;
  return row ? (JSON.parse(row.state) as WatchState) : null;
}

export function saveWatchState(state: WatchState): void {
  getDb()
    .query("INSERT INTO pr_watch_state (id, state) VALUES (1, $state) ON CONFLICT(id) DO UPDATE SET state = $state")
    .run({ $state: JSON.stringify(state) });
}
