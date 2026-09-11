/**
 * Workspace directory and branch naming.
 *
 * Pure string work with no node imports, because the quick-create form
 * previews these names in the browser before anything is created. A second
 * copy of the rule in the client is a copy that drifts — and what the preview
 * is for is the case where the rule surprises the caller: a name with nothing
 * ASCII in it collapses to `sanitizeSlug`'s `workspace` fallback, so the README
 * says `# Task: ログイン時のクラッシュ` while the branch says `workspace`.
 */

/**
 * Convert any input string to a filesystem-safe ASCII slug.
 * - Replaces non-ASCII characters, spaces, and special chars with hyphens
 * - Collapses multiple hyphens
 * - Trims hyphens from start/end
 * - Lowercases everything
 * - Truncates to maxLength (default 50)
 * - Falls back to "workspace" if result is empty (e.g., pure non-ASCII input)
 */
export function sanitizeSlug(input: string, maxLength = 50): string {
  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")  // Replace non-ASCII, spaces, special chars with hyphens
    .replace(/-+/g, "-")          // Collapse multiple hyphens
    .replace(/^-+|-+$/g, "");     // Trim leading/trailing hyphens

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, ""); // Trim trailing hyphens from truncation
  }

  return slug || "workspace";
}

/** The `YYYYMMDD` stamp both workspace directories and branches carry. */
export function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * The workspace directory name, before any collision suffix. A ticket id
 * already present in the name is stripped from the slug rather than repeated,
 * since it becomes its own segment.
 */
export function workspaceDirName(input: {
  taskType: string;
  /** Raw name or task description — slugged here. */
  name: string;
  ticketId?: string;
  dateStamp: string;
}): string {
  let slug = sanitizeSlug(input.name);
  const ticketId = input.ticketId;

  if (ticketId) {
    const tLower = ticketId.toLowerCase();
    slug = slug
      .replace(new RegExp(`^${tLower}-`), "")
      .replace(new RegExp(`-${tLower}-`, "g"), "-")
      .replace(new RegExp(`-${tLower}$`), "");
    if (slug === tLower) slug = "";
    slug = slug.replace(/^-+|-+$/g, "");
    if (!slug) slug = "workspace";
    return `${input.taskType}-${ticketId}-${slug}-${input.dateStamp}`;
  }

  return `${input.taskType}-${slug}-${input.dateStamp}`;
}

/**
 * The branch name for a repository's worktree, derived from the workspace name
 * — which is the only input every caller has in common, so the workspace name
 * is re-parsed here rather than the naming inputs being threaded through.
 * `fallbackDateStamp` is used when the name carries no date suffix.
 */
export function deriveBranchName(
  workspaceName: string,
  repoAlias: string,
  fallbackDateStamp: string,
): string {
  const parts = workspaceName.split("-");
  const taskType = parts[0];
  const date = workspaceName.match(/(\d{8})$/)?.[1] ?? fallbackDateStamp;

  let ticketId = "";
  let description: string;
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

  if (ticketId) {
    return repoAlias
      ? `${taskType}/${ticketId}-${description}-${repoAlias}`
      : `${taskType}/${ticketId}-${description}`;
  }
  return repoAlias
    ? `${taskType}/${description}-${repoAlias}`
    : `${taskType}/${description}-${date}`;
}
