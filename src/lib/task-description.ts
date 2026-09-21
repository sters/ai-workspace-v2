/** The heading the picked repositories are listed under. */
export const SELECTED_REPOS_HEADING = "## Selected Repos";

/**
 * The description an init run is started with: what the user typed, plus the
 * repositories they ticked. The picks travel *inside the text* because
 * `init-readme` decides the workspace's repositories by extracting
 * `github.com/org/repo` paths from the description and from nothing else — a
 * separate field would reach no phase.
 *
 * A repository list is not a request, so a blank description stays blank: that
 * is what keeps the start buttons — which gate on a non-empty description —
 * disabled on ticks alone.
 */
export function withSelectedRepositories(description: string, repositories: string[]): string {
  const typed = description.trim();
  if (!typed || repositories.length === 0) return typed;

  const list = repositories.map((repo) => `- ${repo}`).join("\n");
  return `${typed}\n\n${SELECTED_REPOS_HEADING}\n${list}`;
}
