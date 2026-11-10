/**
 * Repository lessons: what humans' reactions to earlier work in a repository
 * (PR comments, their own follow-up commits, closed PRs) and aiw's recurring
 * review findings say about doing work there. The DB (`repo_lessons`) is the
 * source of truth; only approved lessons reach agents. `.ai-workspace/repo-lessons/<clone>.md`
 * is rendered from it for people to read, and is rewritten on every change.
 */

import { listLessons } from "@/lib/db/repo-lessons";
import { cloneCachePath, cloneKey, writeCacheFile } from "@/lib/workspace/clone-cache";
import { runGit, type GitExec } from "@/lib/workspace/git-exec";
import type { LessonSection, RepoLesson } from "@/types/repo-lessons";

/** Approved lessons a section may hold before the distiller is asked to merge similar ones. */
export const LESSON_SECTION_CAP = 30;

/** The clone key lessons are stored under, falling back to the workspace's repo path outside `repositories/`. */
export async function lessonRepoKey(
  repo: { worktreePath: string; repoPath: string },
  git: GitExec = runGit,
): Promise<string> {
  return (await cloneKey(repo.worktreePath, git)) ?? repo.repoPath;
}

function bullets(lessons: RepoLesson[], section: LessonSection): string {
  return lessons
    .filter((l) => l.section === section)
    .map((l) => `- ${l.text.replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
}

export function renderLessonsMarkdown(repoKey: string, approved: RepoLesson[]): string {
  return `# Lessons for ${repoKey}\n\n<!-- Generated from approved lessons; edit them in the UI (Utilities → Repo Lessons). -->\n\n## Implementation\n\n${bullets(approved, "implementation") || "None yet."}\n\n## Review\n\n${bullets(approved, "review") || "None yet."}\n`;
}

export async function writeLessonsFile(repoKey: string): Promise<void> {
  const approved = listLessons({ repoKey, status: "approved" });
  await writeCacheFile(cloneCachePath(repoKey, "repo-lessons"), renderLessonsMarkdown(repoKey, approved));
}

/** Approved lessons for one section, as bullets for a prompt, or `undefined` when there are none. */
export async function readRepoLessons(
  repo: { worktreePath: string; repoPath: string },
  section: LessonSection,
  git: GitExec = runGit,
): Promise<string | undefined> {
  try {
    const approved = listLessons({ repoKey: await lessonRepoKey(repo, git), status: "approved" });
    return bullets(approved, section) || undefined;
  } catch {
    return undefined;
  }
}
