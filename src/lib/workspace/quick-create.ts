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
 * The contract sections (Non-Goal, Assumptions, Requirements, Acceptance
 * Criteria) are left as the template's comments. The README verifier and the
 * autonomous gate treat them as authoritative, so filling them from a one-line
 * name would hand every later phase a contract nobody wrote; an empty one is
 * honest, and `update-readme` is the path that fills it if the task turns out
 * to be bigger. The same reasoning leaves out the TODO file: the TODO tab
 * renders a `No TODO file` card for a declared repository without one, and that
 * card starts the autonomous path that plans properly.
 *
 * The `# Task:` heading written here is provisional, and `## Goal` is the one
 * contract section that does get written — not here, but on the first turn of
 * the chat this creation hands over to, which is the first thing on the path
 * holding both the request and a model (`getTaskChatSystemPrompt`).
 *
 * A repository entry may also be a GitHub PR URL. Its worktree then checks out
 * the PR's own head branch off the PR's base instead of cutting a new branch,
 * and the PR's title and body are what the workspace is named from and what
 * its `## Initial Request` records when the caller wrote nothing themselves —
 * everything a model would otherwise have been asked to draft a README from.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { quickWorkspaceName } from "@/lib/naming";
import { denormalizeRepoPath } from "@/lib/parsers/readme";
import { parsePrUrl, type PrUrlInfo } from "@/lib/github-pr-url";
import type { SetupRepositoryResult } from "@/types/pipeline";
import type { SelectableRepository } from "@/types/workspace";
import { commitWorkspaceSnapshot, listAllRepositories } from "./git";
import { exec, repoDir } from "./helpers";
import { setupWorkspace } from "./setup";
import type { PrBranchInfo } from "./pr-url";

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
  /**
   * Repository paths, `github.com/org/repo` or `github.com/org/repo:alias`, or
   * a GitHub PR URL for a worktree of that PR's branch.
   */
  repositories: string[];
  /** Optional free text for the README's `## Initial Request`. */
  note?: string;
}

export interface QuickCreateProblem {
  repository: string;
  error: string;
}

/** A PR whose branch is now a worktree of the workspace. */
export interface QuickCreatePullRequest {
  url: string;
  repoPath: string;
  headBranch: string;
}

export interface QuickCreateResult {
  workspace: string;
  workspacePath: string;
  repositories: SetupRepositoryResult[];
  pullRequests: QuickCreatePullRequest[];
  problems: QuickCreateProblem[];
  log: string[];
}

/**
 * Nothing was created: the request had nothing to name a workspace by once its
 * PRs were read. Distinct from a thrown git error, which may land after the
 * workspace directory exists.
 */
export class QuickCreateRefusal extends Error {}

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
    checkoutBranch?: string,
  ) => SetupRepositoryResult;
  /** `gh pr view`, injected for the same reason. */
  resolvePullRequest: (pr: PrUrlInfo) => PrBranchInfo;
}

/** The PR as it goes into `## Initial Request`: what a reader needs without opening it. */
function pullRequestRequest(pr: PrBranchInfo): string {
  const lines = [`GitHub Pull Request: ${pr.prUrl}`];
  if (pr.title) lines.push(`PR Title: ${pr.title}`);
  if (pr.body.trim()) lines.push("", "PR Description:", pr.body.trim());
  lines.push(
    "",
    `Its branch \`${pr.headBranch}\` (targeting \`${pr.baseBranch}\`) is checked out as this workspace's worktree.`,
  );
  return lines.join("\n");
}

/**
 * Read every PR entry before anything is created, since a PR's title may be
 * the only thing to name the workspace by. Keyed by the entry as typed.
 */
function resolvePullRequests(
  entries: string[],
  resolve: QuickCreateDeps["resolvePullRequest"],
  problems: QuickCreateProblem[],
): Map<string, PrBranchInfo> {
  const resolved = new Map<string, PrBranchInfo>();
  const repos = new Set<string>();

  for (const entry of entries) {
    const info = parsePrUrl(entry);
    if (!info) continue;

    let pr: PrBranchInfo;
    try {
      pr = resolve(info);
    } catch (err) {
      problems.push({ repository: entry, error: String(err) });
      continue;
    }
    // `origin/<head>` does not exist for a fork's branch, so there is nothing
    // to check out.
    if (pr.isFork) {
      problems.push({
        repository: entry,
        error: `PR #${info.prNumber} comes from a fork (${pr.headBranch}); fork PRs cannot be checked out yet.`,
      });
      continue;
    }
    // Both would claim the same worktree directory, and a PR checkout clears
    // whatever is already there.
    if (repos.has(info.repoPath)) {
      problems.push({
        repository: entry,
        error: `Another PR of ${info.repoPath} is already in this workspace; this one needs a workspace of its own.`,
      });
      continue;
    }
    repos.add(info.repoPath);
    resolved.set(entry, pr);
  }

  return resolved;
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
  const problems: QuickCreateProblem[] = [];
  const pullRequestsByEntry = resolvePullRequests(
    input.repositories,
    deps.resolvePullRequest,
    problems,
  );
  const resolved = [...pullRequestsByEntry.values()];
  const prRepos = new Set(resolved.map((pr) => pr.repoPath));

  const note = input.note?.trim() ?? "";
  // The note is the field that says what the change is, so a caller who wrote
  // one does not have to name the workspace as well; a PR's title says the
  // same thing for a caller who wrote neither.
  const name =
    quickWorkspaceName(input.name ?? "", note) || quickWorkspaceName("", resolved[0]?.title ?? "");
  if (!name) {
    const why = problems.map((p) => `${p.repository}: ${p.error}`).join("; ");
    throw new QuickCreateRefusal(
      `Nothing to name the workspace by — give a name or a note${why ? ` (${why})` : ""}`,
    );
  }
  const description = [note, ...resolved.map(pullRequestRequest)].filter(Boolean).join("\n\n") || name;

  const { workspaceName, workspacePath } = await setupWorkspace(
    input.taskType,
    description,
    undefined,
    name,
  );

  const repositories: SetupRepositoryResult[] = [];
  const pullRequests: QuickCreatePullRequest[] = [];
  const log: string[] = [];

  for (const entry of input.repositories) {
    const pr = pullRequestsByEntry.get(entry);
    // A PR that could not be read is already a problem; a plain entry for a
    // repository a PR brings is the same worktree directory.
    if (!pr && (parsePrUrl(entry) || prRepos.has(entry))) continue;

    const emit = (message: string) => {
      log.push(`[${entry}] ${message}`);
    };
    try {
      if (pr) {
        repositories.push(
          deps.setupRepository(workspaceName, pr.repoPath, pr.baseBranch, emit, pr.headBranch),
        );
        pullRequests.push({ url: pr.prUrl, repoPath: pr.repoPath, headBranch: pr.headBranch });
      } else {
        repositories.push(deps.setupRepository(workspaceName, entry, undefined, emit));
      }
    } catch (err) {
      problems.push({ repository: entry, error: String(err) });
      log.push(`[${entry}] Failed: ${err}`);
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

  return { workspace: workspaceName, workspacePath, repositories, pullRequests, problems, log };
}
