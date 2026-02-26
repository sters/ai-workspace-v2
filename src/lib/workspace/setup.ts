/**
 * Workspace setup — creating workspaces, setting up repositories, detecting branches.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";
import { buildReadmeContent } from "../templates";
import { exec, repoDir, sanitizeSlug } from "./helpers";

// ---------------------------------------------------------------------------
// Task analysis — structured metadata extraction via Claude child process
// ---------------------------------------------------------------------------

export interface TaskAnalysis {
  taskType: string;
  slug: string;
  ticketId: string;
  repositories: string[];
}

/**
 * Parse a TaskAnalysis from structured JSON text (from --json-schema output).
 * Uses Bun.JSONL.parseChunk for non-throwing parse with error reporting.
 * Returns a fallback if the text is empty or unparseable.
 */
export function parseAnalysisResultText(jsonText: string | undefined, fallbackDescription: string): TaskAnalysis {
  const fallback: TaskAnalysis = {
    taskType: "feature",
    slug: sanitizeSlug(fallbackDescription),
    ticketId: "",
    repositories: [],
  };

  if (!jsonText) return fallback;

  const { values, error } = Bun.JSONL.parseChunk(jsonText);
  if (error || values.length === 0) return fallback;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = values[0] as Record<string, any>;
  return {
    taskType: parsed.taskType || fallback.taskType,
    slug: sanitizeSlug(parsed.slug || "") || fallback.slug,
    ticketId: parsed.ticketId || "",
    repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
  };
}

const GITIGNORE_CONTENT = `# Exclude repository worktrees (they are separate git repos)
github.com/
gitlab.com/
bitbucket.org/

# Exclude temporary files
tmp/
*.tmp
*.log
`;

// ---------------------------------------------------------------------------
// setupWorkspace
// ---------------------------------------------------------------------------

export interface SetupWorkspaceResult {
  workspaceName: string;
  workspacePath: string;
}

export async function setupWorkspace(
  taskType: string,
  description: string,
  ticketId?: string,
  preGeneratedSlug?: string,
): Promise<SetupWorkspaceResult> {
  // Use pre-generated slug if provided, otherwise sanitize the description
  let slug = preGeneratedSlug
    ? sanitizeSlug(preGeneratedSlug)
    : sanitizeSlug(description);

  // Strip ticket ID from slug if already provided separately
  if (ticketId) {
    const tLower = ticketId.toLowerCase();
    slug = slug
      .replace(new RegExp(`^${tLower}-`), "")
      .replace(new RegExp(`-${tLower}-`, "g"), "-")
      .replace(new RegExp(`-${tLower}$`), "");
    if (slug === tLower) slug = "";
    slug = slug.replace(/^-+|-+$/g, "");
    if (!slug) slug = "workspace";
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let dirName = ticketId
    ? `${taskType}-${ticketId}-${slug}-${date}`
    : `${taskType}-${slug}-${date}`;

  // If the directory already exists, append a numeric suffix
  let wsPath = path.join(WORKSPACE_DIR, dirName);
  if (existsSync(wsPath)) {
    let suffix = 2;
    while (existsSync(path.join(WORKSPACE_DIR, `${dirName}-${suffix}`))) {
      suffix++;
    }
    dirName = `${dirName}-${suffix}`;
    wsPath = path.join(WORKSPACE_DIR, dirName);
  }

  // Create directories
  mkdirSync(wsPath, { recursive: true });
  mkdirSync(path.join(wsPath, "tmp"), { recursive: true });
  mkdirSync(path.join(wsPath, "artifacts"), { recursive: true });
  await Bun.write(path.join(wsPath, "artifacts", ".gitkeep"), "");

  // Initialize git
  exec(`git init --quiet "${wsPath}"`);

  // Write .gitignore
  await Bun.write(path.join(wsPath, ".gitignore"), GITIGNORE_CONTENT);

  // Write README
  const dateFormatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const readme = buildReadmeContent(description, taskType, ticketId ?? "N/A", dateFormatted);
  await Bun.write(path.join(wsPath, "README.md"), readme);

  // Initial commit
  exec(`git -C "${wsPath}" add .gitignore README.md artifacts/`);
  exec(`git -C "${wsPath}" commit --quiet -m "Initial: ${dirName} workspace created"`);

  return { workspaceName: dirName, workspacePath: wsPath };
}

// ---------------------------------------------------------------------------
// detectBaseBranch
// ---------------------------------------------------------------------------

export function detectBaseBranch(repoAbsPath: string): string {
  // 1. symbolic-ref
  try {
    const ref = exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 2. set-head --auto
  try {
    exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    const ref = exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 3. common branch names
  for (const b of ["main", "master", "develop", "development"]) {
    try {
      exec(
        `git -C "${repoAbsPath}" show-ref --verify --quiet refs/remotes/origin/${b}`,
      );
      return b;
    } catch { /* continue */ }
  }

  // 4. current branch
  try {
    const current = exec(`git -C "${repoAbsPath}" rev-parse --abbrev-ref HEAD`);
    if (current && current !== "HEAD") return current;
  } catch { /* continue */ }

  throw new Error(`Could not determine base branch for ${repoAbsPath}`);
}

// ---------------------------------------------------------------------------
// setupRepository
// ---------------------------------------------------------------------------

export interface SetupRepositoryResult {
  repoPath: string; // e.g. github.com/org/repo
  repoName: string; // e.g. repo
  worktreePath: string; // absolute path
  baseBranch: string;
  branchName: string;
}

export function setupRepository(
  workspaceName: string,
  repositoryPathArg: string,
  baseBranchOverride?: string,
  log?: (message: string) => void,
): SetupRepositoryResult {
  const emit = log ?? (() => {});

  // Parse alias syntax (e.g. github.com/org/repo:dev)
  let actualRepoPath = repositoryPathArg;
  let repoAlias = "";
  let repoPathInput = repositoryPathArg;
  if (repositoryPathArg.includes(":")) {
    actualRepoPath = repositoryPathArg.split(":")[0];
    repoAlias = repositoryPathArg.split(":").slice(1).join(":");
    repoPathInput = `${actualRepoPath}___${repoAlias}`;
  }

  const repoName = path.basename(repoPathInput);
  const repoAbsPath = path.join(repoDir(), actualRepoPath);
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);

  if (!existsSync(wsPath)) {
    throw new Error(`Workspace directory does not exist: ${wsPath}`);
  }

  // Clone or fetch
  if (!existsSync(repoAbsPath)) {
    emit(`Repository not found locally, cloning ${actualRepoPath}...`);
    const parentDir = path.dirname(repoAbsPath);
    mkdirSync(parentDir, { recursive: true });
    const repoUrl = `https://${actualRepoPath}.git`;
    exec(`git clone "${repoUrl}" "${repoAbsPath}"`);
    emit("Clone complete.");
    try {
      exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
  } else {
    emit(`Repository found locally, fetching latest...`);
    exec(`git -C "${repoAbsPath}" fetch --all --prune`);
    try {
      exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
  }

  // Detect base branch
  const baseBranch = baseBranchOverride ?? detectBaseBranch(repoAbsPath);
  emit(`Base branch: ${baseBranch}`);

  // Extract task info from workspace name for branch naming
  const parts = workspaceName.split("-");
  const taskType = parts[0];
  const dateMatch = workspaceName.match(/(\d{8})$/);
  const date = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");

  // Detect ticket ID
  let ticketId = "";
  let description = "";
  if (parts.length > 1 && /^[A-Z]+[-]?\d+$/i.test(parts[1])) {
    ticketId = parts[1];
    description = workspaceName
      .replace(new RegExp(`^${taskType}-${ticketId}-`), "")
      .replace(new RegExp(`-${date}$`), "");
  } else {
    description = workspaceName
      .replace(new RegExp(`^${taskType}-`), "")
      .replace(new RegExp(`-${date}$`), "");
  }

  // Build branch name
  let branchName: string;
  if (ticketId) {
    branchName = repoAlias
      ? `${taskType}/${ticketId}-${description}-${repoAlias}`
      : `${taskType}/${ticketId}-${description}`;
  } else {
    branchName = repoAlias
      ? `${taskType}/${description}-${repoAlias}`
      : `${taskType}/${description}-${date}`;
  }

  // Create worktree — use absolute path so git -C doesn't resolve it
  // relative to the repository directory
  const worktreePath = path.resolve(path.join(wsPath, repoPathInput));
  mkdirSync(path.dirname(worktreePath), { recursive: true });

  // If the branch already exists, resolve the conflict
  try {
    exec(`git -C "${repoAbsPath}" rev-parse --verify "${branchName}"`);
    emit(`Branch ${branchName} already exists, resolving...`);
    try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }

    const worktreeList = exec(`git -C "${repoAbsPath}" worktree list --porcelain`);
    const isInUse = worktreeList
      .split("\n")
      .some((line) => line === `branch refs/heads/${branchName}`);

    if (isInUse) {
      const origName = branchName;
      let suffix = 2;
      while (true) {
        const candidate = `${branchName}-${suffix}`;
        try {
          exec(`git -C "${repoAbsPath}" rev-parse --verify "${candidate}"`);
          suffix++;
        } catch {
          branchName = candidate;
          break;
        }
      }
      emit(`Branch ${origName} in use by another worktree, using ${branchName} instead.`);
    } else {
      emit(`Branch is stale, deleting and recreating.`);
      exec(`git -C "${repoAbsPath}" branch -D "${branchName}"`);
    }
  } catch {
    // Branch doesn't exist — good
  }

  // If the target directory already exists (e.g. from a previous failed attempt),
  // remove it before creating the worktree
  if (existsSync(worktreePath)) {
    emit(`Target directory already exists, removing: ${repoPathInput}`);
    rmSync(worktreePath, { recursive: true, force: true });
    try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
  }

  emit(`Creating worktree: branch ${branchName} from origin/${baseBranch}`);
  const worktreeOutput = exec(
    `git -C "${repoAbsPath}" worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`,
  );
  if (worktreeOutput) {
    emit(`git worktree add: ${worktreeOutput}`);
  }

  // Verify the worktree was actually created
  if (!existsSync(path.join(worktreePath, ".git"))) {
    // Log diagnostic info
    const list = exec(`git -C "${repoAbsPath}" worktree list`);
    emit(`Worktree list after add: ${list}`);
    throw new Error(
      `git worktree add returned successfully but ${worktreePath}/.git does not exist. ` +
      `repoAbsPath=${repoAbsPath}, branchName=${branchName}, baseBranch=origin/${baseBranch}`,
    );
  }
  emit(`Worktree ready at ${repoPathInput}`);

  return {
    repoPath: repoPathInput,
    repoName,
    worktreePath,
    baseBranch,
    branchName,
  };
}
