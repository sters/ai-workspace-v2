// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { insertLesson, setLessonStatus } from "@/lib/db/repo-lessons";
import { readRepoLessons } from "@/lib/lessons";
import { buildExecutorPrompt } from "@/lib/templates";
import type { GitExec } from "@/lib/workspace/git-exec";

const notAClone: GitExec = async () => ({ ok: false, out: "" });
const repo = { worktreePath: "/ws/widgets", repoPath: "github.com/acme/widgets" };

describe("repository lessons reach agents", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("hands only approved lessons of the asked section to the prompt", async () => {
    const approve = (section: "implementation" | "review", text: string) =>
      setLessonStatus(insertLesson({ repoKey: repo.repoPath, section, text, sourceWorkspace: "ws", evidence: [] }), "approved");
    approve("implementation", "Add a down migration with every schema change");
    approve("review", "Do not flag config values as unvalidated");
    insertLesson({ repoKey: repo.repoPath, section: "implementation", text: "Unreviewed candidate", sourceWorkspace: "ws", evidence: [] });

    const lessons = await readRepoLessons(repo, "implementation", notAClone);
    expect(lessons).toBe("- Add a down migration with every schema change");

    const prompt = buildExecutorPrompt({
      workspaceName: "ws",
      repoName: "widgets",
      repoPath: repo.repoPath,
      worktreePath: repo.worktreePath,
      workspacePath: "/ws",
      readmeContent: "# Task",
      todoContent: "- [ ] do it",
      repoLessons: lessons,
    });
    expect(prompt).toContain("## Repository Lessons");
    expect(prompt).toContain("Add a down migration with every schema change");
    expect(prompt).not.toContain("Unreviewed candidate");
  });

  it("adds no section when a repository has no approved lessons", async () => {
    expect(await readRepoLessons(repo, "review", notAClone)).toBeUndefined();
  });
});
