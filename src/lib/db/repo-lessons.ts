import { randomUUID } from "node:crypto";
import { getDb } from "./connection";
import type {
  DistilledLesson,
  LessonEvidence,
  LessonSection,
  LessonStatus,
  RepoLesson,
} from "@/types/repo-lessons";

interface LessonRow {
  id: string;
  repo_key: string;
  section: string;
  text: string;
  status: string;
  evidence_json: string;
  replaces_json: string;
  source_workspace: string;
  created_at: string;
  updated_at: string;
}

function parseArray<T>(raw: string): T[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function toLesson(row: LessonRow): RepoLesson {
  return {
    id: row.id,
    repoKey: row.repo_key,
    section: row.section as LessonSection,
    text: row.text,
    status: row.status as LessonStatus,
    evidence: parseArray<LessonEvidence>(row.evidence_json),
    replaces: parseArray<string>(row.replaces_json),
    sourceWorkspace: row.source_workspace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function insertLesson(input: {
  repoKey: string;
  section: LessonSection;
  text: string;
  sourceWorkspace: string;
  evidence: LessonEvidence[];
  replaces?: string[];
}): string {
  const id = randomUUID();
  getDb()
    .query(
      `INSERT INTO repo_lessons (id, repo_key, section, text, status, evidence_json, replaces_json, source_workspace)
       VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?)`,
    )
    .run(id, input.repoKey, input.section, input.text, JSON.stringify(input.evidence), JSON.stringify(input.replaces ?? []), input.sourceWorkspace);
  return id;
}

export function getLesson(id: string): RepoLesson | null {
  const row = getDb().query("SELECT * FROM repo_lessons WHERE id = ?").get(id) as LessonRow | null;
  return row ? toLesson(row) : null;
}

export function listLessons(filter: { repoKey?: string; status?: LessonStatus } = {}): RepoLesson[] {
  const rows = getDb()
    .query(
      `SELECT * FROM repo_lessons
       WHERE ($repoKey IS NULL OR repo_key = $repoKey) AND ($status IS NULL OR status = $status)
       ORDER BY repo_key, section, created_at`,
    )
    .all({ $repoKey: filter.repoKey ?? null, $status: filter.status ?? null }) as LessonRow[];
  return rows.map(toLesson);
}

export function countCandidateLessons(): number {
  const row = getDb().query("SELECT COUNT(*) AS n FROM repo_lessons WHERE status = 'candidate'").get() as { n: number };
  return row.n;
}

/** Approving a merge supersedes the lessons it replaces, in the same transaction. */
export function setLessonStatus(id: string, status: LessonStatus): RepoLesson | null {
  const db = getDb();
  db.transaction(() => {
    db.query(`UPDATE repo_lessons SET status = ?, updated_at = ${NOW} WHERE id = ?`).run(status, id);
    const lesson = getLesson(id);
    if (status !== "approved" || !lesson) return;
    for (const replaced of lesson.replaces) {
      db.query(
        `UPDATE repo_lessons SET status = 'superseded', updated_at = ${NOW} WHERE id = ? AND repo_key = ? AND status = 'approved'`,
      ).run(replaced, lesson.repoKey);
    }
  })();
  return getLesson(id);
}

export function updateLessonText(id: string, text: string): RepoLesson | null {
  getDb().query(`UPDATE repo_lessons SET text = ?, updated_at = ${NOW} WHERE id = ?`).run(text, id);
  return getLesson(id);
}

function addEvidence(lesson: RepoLesson, evidence: LessonEvidence[]): void {
  getDb()
    .query(`UPDATE repo_lessons SET evidence_json = ?, updated_at = ${NOW} WHERE id = ?`)
    .run(JSON.stringify([...lesson.evidence, ...evidence]), lesson.id);
}

/** Lowercase letters and digits only, so punctuation and case drift still match. */
function wordingKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Apply one distillation of one repository. The model's dedup judgement is
 * enforced here rather than trusted: a rejected lesson never comes back, by id
 * or by wording, and a "new" lesson worded like a live one is folded into it.
 */
export function applyDistilledLessons(
  repoKey: string,
  workspace: string,
  distilled: DistilledLesson[],
): { added: number; reinforced: number; dropped: number } {
  const result = { added: 0, reinforced: 0, dropped: 0 };
  const db = getDb();
  db.transaction(() => {
    for (const d of distilled) {
      const existing = listLessons({ repoKey });
      const byId = new Map(existing.map((l) => [l.id, l]));
      const evidence = d.evidence.map((e) => ({ workspace, ...e }));
      const live = (l: RepoLesson | undefined) => l && (l.status === "approved" || l.status === "candidate");

      if (d.action === "reinforce") {
        const target = byId.get(d.targetIds[0] ?? "");
        if (!live(target)) {
          result.dropped++;
          continue;
        }
        addEvidence(target!, evidence);
        result.reinforced++;
        continue;
      }

      const key = wordingKey(d.text);
      if (!key) {
        result.dropped++;
        continue;
      }
      const sameWording = existing.filter((l) => wordingKey(l.text) === key);
      if (sameWording.some((l) => l.status === "rejected")) {
        result.dropped++;
        continue;
      }
      const liveMatch = sameWording.find((l) => live(l));
      if (liveMatch) {
        addEvidence(liveMatch, evidence);
        result.reinforced++;
        continue;
      }

      if (d.action === "merge") {
        const targets = d.targetIds.map((id) => byId.get(id));
        if (targets.length < 1 || targets.some((t) => t?.status !== "approved")) {
          result.dropped++;
          continue;
        }
      }

      insertLesson({
        repoKey,
        section: d.section,
        text: d.text.trim(),
        sourceWorkspace: workspace,
        evidence,
        replaces: d.action === "merge" ? d.targetIds : [],
      });
      result.added++;
    }
  })();
  return result;
}

export interface LessonFinding {
  workspace: string;
  summary: string;
  kind: string;
}

/** Record a workspace's review findings for one repository, so later workspaces can see what recurs. */
export function recordLessonFindings(repoKey: string, workspace: string, findings: { summary: string; kind: string }[]): void {
  const db = getDb();
  const insert = db.query(
    "INSERT OR IGNORE INTO lesson_findings (repo_key, workspace, summary, kind) VALUES (?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const f of findings) insert.run(repoKey, workspace, f.summary, f.kind);
  })();
}

export function listPriorLessonFindings(repoKey: string, excludeWorkspace: string, limit: number): LessonFinding[] {
  return getDb()
    .query(
      `SELECT workspace, summary, kind FROM lesson_findings
       WHERE repo_key = ? AND workspace != ? ORDER BY rowid DESC LIMIT ?`,
    )
    .all(repoKey, excludeWorkspace, limit) as LessonFinding[];
}
