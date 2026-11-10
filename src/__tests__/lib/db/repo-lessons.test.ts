// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  applyDistilledLessons,
  insertLesson,
  listLessons,
  setLessonStatus,
} from "@/lib/db/repo-lessons";

const REPO = "github.com/acme/widgets";

function byText(text: string) {
  return listLessons({ repoKey: REPO }).find((l) => l.text === text)!;
}

describe("db/repo-lessons", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("adds a new lesson as a candidate with its evidence", () => {
    const { added } = applyDistilledLessons(REPO, "ws-1", [
      { action: "new", section: "implementation", text: "Use the shared clock helper", targetIds: [], evidence: [{ note: "reviewer asked", url: "u1" }] },
    ]);
    expect(added).toBe(1);
    const lesson = byText("Use the shared clock helper");
    expect(lesson.status).toBe("candidate");
    expect(lesson.evidence).toEqual([{ workspace: "ws-1", note: "reviewer asked", url: "u1" }]);
  });

  it("appends evidence to an approved lesson the distiller says it repeats", () => {
    const id = insertLesson({ repoKey: REPO, section: "review", text: "Check migrations are reversible", sourceWorkspace: "ws-0", evidence: [] });
    setLessonStatus(id, "approved");
    const { reinforced } = applyDistilledLessons(REPO, "ws-1", [
      { action: "reinforce", section: "review", text: "", targetIds: [id], evidence: [{ note: "again" }] },
    ]);
    expect(reinforced).toBe(1);
    expect(listLessons({ repoKey: REPO })).toHaveLength(1);
    expect(byText("Check migrations are reversible").evidence).toEqual([{ workspace: "ws-1", note: "again" }]);
  });

  it("never re-proposes a rejected lesson, whether by id or by wording", () => {
    const id = insertLesson({ repoKey: REPO, section: "implementation", text: "Prefer tabs.", sourceWorkspace: "ws-0", evidence: [] });
    setLessonStatus(id, "rejected");
    const result = applyDistilledLessons(REPO, "ws-1", [
      { action: "reinforce", section: "implementation", text: "", targetIds: [id], evidence: [{ note: "x" }] },
      { action: "new", section: "implementation", text: "prefer TABS", targetIds: [], evidence: [{ note: "y" }] },
    ]);
    expect(result).toEqual({ added: 0, reinforced: 0, dropped: 2 });
    expect(listLessons({ repoKey: REPO })[0].evidence).toEqual([]);
  });

  it("folds a new lesson worded like an existing one into it", () => {
    insertLesson({ repoKey: REPO, section: "implementation", text: "Run the formatter before committing", sourceWorkspace: "ws-0", evidence: [] });
    const { reinforced } = applyDistilledLessons(REPO, "ws-1", [
      { action: "new", section: "implementation", text: "Run the formatter before committing.", targetIds: [], evidence: [{ note: "z" }] },
    ]);
    expect(reinforced).toBe(1);
    expect(listLessons({ repoKey: REPO })).toHaveLength(1);
  });

  it("supersedes the lessons a merge replaces only once the merge is approved", () => {
    const a = insertLesson({ repoKey: REPO, section: "review", text: "A", sourceWorkspace: "ws-0", evidence: [] });
    const b = insertLesson({ repoKey: REPO, section: "review", text: "B", sourceWorkspace: "ws-0", evidence: [] });
    setLessonStatus(a, "approved");
    setLessonStatus(b, "approved");
    applyDistilledLessons(REPO, "ws-1", [
      { action: "merge", section: "review", text: "A and B", targetIds: [a, b], evidence: [] },
    ]);
    expect(byText("A").status).toBe("approved");

    setLessonStatus(byText("A and B").id, "approved");
    expect(byText("A").status).toBe("superseded");
    expect(byText("B").status).toBe("superseded");
  });

  it("drops a merge that names a lesson which is not approved", () => {
    const a = insertLesson({ repoKey: REPO, section: "review", text: "A", sourceWorkspace: "ws-0", evidence: [] });
    const { dropped } = applyDistilledLessons(REPO, "ws-1", [
      { action: "merge", section: "review", text: "A2", targetIds: [a], evidence: [] },
    ]);
    expect(dropped).toBe(1);
  });

  it("keeps lessons of other repositories apart", () => {
    const other = insertLesson({ repoKey: "github.com/acme/other", section: "review", text: "X", sourceWorkspace: "ws-0", evidence: [] });
    const { dropped } = applyDistilledLessons(REPO, "ws-1", [
      { action: "reinforce", section: "review", text: "", targetIds: [other], evidence: [{ note: "n" }] },
    ]);
    expect(dropped).toBe(1);
  });
});
