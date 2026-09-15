/**
 * Deterministic workspace creation: pick repositories, get worktrees.
 *
 * Nothing on this path calls Claude. `init` spends its first phase having a
 * model name the workspace and draft the done-contract README, and its later
 * phases discovering constraints and planning TODOs — the right trade for a
 * task whose shape nobody knows yet, and the wrong one for a change whose plan
 * already fits in the author's head. What that author still cannot do in one
 * step is the part kept here: a worktree per repository cut from its base
 * branch, and a README whose `## Repositories` section the rest of the tooling
 * can read.
 *
 * The contract sections (Goal, Non-Goal, Acceptance Criteria, …) are left as
 * the template's comments. The README verifier and the autonomous gate treat
 * them as authoritative, so filling them from a one-line name would hand every
 * later phase a contract nobody wrote; an empty one is honest, and
 * `update-readme` is the path that fills it if the task turns out to be bigger.
 * The same reasoning leaves out the TODO file: the TODO tab renders a
 * `No TODO file` card for a declared repository without one, and that card
 * starts the autonomous path that plans properly.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { quickWorkspaceName } from "@/lib/naming";
import { denormalizeRepoPath } from "@/lib/parsers/readme";
import type { SetupRepositoryResult } from "@/types/pipeline";
import type { SelectableRepository } from "@/types/workspace";
import { commitWorkspaceSnapshot, listAllRepositories } from "./git";
import { exec, repoDir } from "./helpers";
import { setupWorkspace } from "./setup";

const COMMON_BASE_BRANCHES = ["main", "master", "develop", "development"];

/**
 * The base branch as the refs already on disk report it, with no network call.
 *
 * This answers a *display* question for a picker that runs it once per
 * repository on every page load, where `detectBaseBranch` answers the question
 * `git worktree add` is about to be held to — it may run `remote set-head
 * --auto`, which talks to the remote, and it throws when it cannot decide.
 * Creation still goes through that one; an empty string here only means the
 * row has nothing to show.
 */
function localBaseBranch(repoAbsPath: string): string {
  try {
    const ref = exec(`git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`);
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* fall through to the common names */ }

  for (const branch of COMMON_BASE_BRANCHES) {
    try {
      exec(`git -C "${repoAbsPath}" show-ref --verify --quiet refs/remotes/origin/${branch}`);
      return branch;
    } catch { /* try the next one */ }
  }
  return "";
}

/**
 * The already-cloned repositories, for the picker. A repository absent from
 * this list is still usable — the caller may type its path, and setup clones
 * it — so this is a shortcut, not the set of allowed values.
 */
export function listSelectableRepositories(): SelectableRepository[] {
  return listAllRepositories().map((repo) => ({
    repoPath: repo.repoPath,
    repoName: repo.repoName,
    baseBranch: localBaseBranch(path.join(repoDir(), repo.repoPath)),
  }));
}

export interface QuickCreateInput {
  /**
   * Free text; becomes the README title, and its slug the directory name.
   * Optional — the note's first line is used when it is empty.
   */
  name?: string;
  /** Prefixes the workspace directory and every branch (`bugfix/…`). */
  taskType: string;
  /** Repository paths, `github.com/org/repo` or `github.com/org/repo:alias`. */
  repositories: string[];
  /** Optional free text for the README's `## Initial Request`. */
  note?: string;
}

export interface QuickCreateProblem {
  repository: string;
  error: string;
}

export interface QuickCreateResult {
  workspace: string;
  workspacePath: string;
  repositories: SetupRepositoryResult[];
  problems: QuickCreateProblem[];
  log: string[];
}

export interface QuickCreateDeps {
  /**
   * Injected rather than imported: the real one lives under `lib/pipelines/`,
   * which imports this layer, and the tests need a seam that does not run git.
   */
  setupRepository: (
    workspaceName: string,
    repositoryPath: string,
    baseBranchOverride: string | undefined,
    emitStatus: (message: string) => void,
  ) => SetupRepositoryResult;
}

/** The first non-empty line, whitespace collapsed — a README heading is one line. */
function headingLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean)?.replace(/\s+/g, " ") ?? "";
}

/**
 * Replace an h2 section's body, or append the section when it is absent.
 * Stops at the next h1/h2 the way the README parsers do, so an `###` block
 * inside the section travels with it.
 */
function replaceSection(content: string, heading: string, body: string): string {
  const start = content.indexOf(`${heading}\n`);
  if (start < 0) return `${content.trimEnd()}\n\n${heading}\n\n${body}\n`;

  const afterHeading = start + heading.length;
  const next = content.slice(afterHeading).match(/\n## |\n# /);
  const end = next ? afterHeading + next.index! : content.length;
  return `${content.slice(0, afterHeading)}\n\n${body}\n${content.slice(end)}`;
}

/**
 * Fill the two README sections this path knows the answer to: the title and
 * the repository table. Everything else is left exactly as the template wrote
 * it.
 */
export function fillQuickReadme(
  content: string,
  input: { title: string; repositories: SetupRepositoryResult[] },
): string {
  const title = headingLine(input.title);
  const titled = /^# Task: .*$/m.test(content)
    ? content.replace(/^# Task: .*$/m, `# Task: ${title}`)
    : `# Task: ${title}\n\n${content}`;

  const body = input.repositories.length > 0
    ? input.repositories
        .map(
          (repo) =>
            `- **${repo.repoName}**: \`${denormalizeRepoPath(repo.repoPath)}\` (base: \`${repo.baseBranch}\`)`,
        )
        .join("\n")
    : "<!-- No worktree was created. Add repositories here and run update-readme to set them up. -->";

  return replaceSection(titled, "## Repositories", body);
}

/**
 * Create a workspace and its worktrees, and report what happened.
 *
 * A repository that fails to set up is reported rather than fatal, and the
 * README declares only the worktrees that exist: the workspace is already on
 * disk by then, and declaring a repository without a worktree makes every
 * later phase report it as missing. Same trade `setupRepository` makes with a
 * failed fetch — the run keeps whatever it managed to get.
 */
export async function createQuickWorkspace(
  input: QuickCreateInput,
  deps: QuickCreateDeps,
): Promise<QuickCreateResult> {
  const note = input.note?.trim() ?? "";
  // The note is the field that says what the change is, so a caller who wrote
  // one does not have to name the workspace as well.
  const name = quickWorkspaceName(input.name ?? "", note);
  const description = note || name;

  const { workspaceName, workspacePath } = await setupWorkspace(
    input.taskType,
    description,
    undefined,
    name,
  );

  const repositories: SetupRepositoryResult[] = [];
  const problems: QuickCreateProblem[] = [];
  const log: string[] = [];

  for (const repository of input.repositories) {
    try {
      repositories.push(
        deps.setupRepository(workspaceName, repository, undefined, (message) => {
          log.push(`[${repository}] ${message}`);
        }),
      );
    } catch (err) {
      problems.push({ repository, error: String(err) });
      log.push(`[${repository}] Failed: ${err}`);
    }
  }

  const readmePath = path.join(workspacePath, "README.md");
  if (existsSync(readmePath)) {
    const content = await Bun.file(readmePath).text();
    await Bun.write(
      readmePath,
      fillQuickReadme(content, { title: name || workspaceName, repositories }),
    );
  }

  await commitWorkspaceSnapshot(workspaceName, `Quick init: ${workspaceName} created`);

  return { workspace: workspaceName, workspacePath, repositories, problems, log };
}
