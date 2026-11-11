import { getDb } from "./connection";
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

function toSnapshot(row: SnapshotRow): PrWatchSnapshot {
  let seen: unknown;
  try {
    seen = JSON.parse(row.seen_comments);
  } catch {
    seen = [];
  }
  return {
    workspace: row.workspace,
    repoName: row.repo_name,
    prUrl: row.pr_url,
    state: row.state,
    headSha: row.head_sha,
    ci: row.ci as PrCiState,
    mergeable: row.mergeable,
    seenComments: Array.isArray(seen) ? seen.filter((s): s is string => typeof s === "string") : [],
  };
}

/** Replace the snapshot and append its events in one transaction, so a crash cannot record one without the other. */
export function savePrObservation(snapshot: PrWatchSnapshot, events: PrEventInput[]): void {
  const db = getDb();
  db.transaction(() => {
    db.query(
      `INSERT OR REPLACE INTO pr_watch (workspace, repo_name, pr_url, state, head_sha, ci, mergeable, seen_comments, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ).run(
      snapshot.workspace,
      snapshot.repoName,
      snapshot.prUrl,
      snapshot.state,
      snapshot.headSha,
      snapshot.ci,
      snapshot.mergeable,
      JSON.stringify(snapshot.seenComments),
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
