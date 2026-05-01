import path from "node:path";
import type { WorkspaceMeta } from "@/types/workspace";

export interface RepoConstraint {
  label: string;
  command: string;
}

export interface RepoConstraints {
  repoName: string;
  constraints: RepoConstraint[];
}

/**
 * Read README.md from a workspace path and parse its metadata.
 * Returns both the raw content and the parsed meta.
 */
export async function readWorkspaceReadme(wsPath: string): Promise<{ content: string; meta: WorkspaceMeta }> {
  const content = await Bun.file(path.join(wsPath, "README.md")).text();
  return { content, meta: parseReadmeMeta(content) };
}

export function parseReadmeMeta(content: string): WorkspaceMeta {
  const titleMatch = content.match(/^#\s+Task:\s+(.+)$/m);
  const taskTypeMatch = content.match(/\*\*Task Type\*\*:\s*(\S+)/);
  const ticketIdMatch = content.match(/\*\*Ticket ID\*\*:\s*(\S+)/);
  const dateMatch = content.match(/\*\*Date\*\*:\s*(\S+)/);

  const repositories: WorkspaceMeta["repositories"] = [];
  const repoPattern =
    /- \*\*(\S+?)\*\*:\s*`([^`]+)`\s*\(base:\s*`([^`]+)`\)/g;
  let match;
  while ((match = repoPattern.exec(content)) !== null) {
    repositories.push({
      alias: match[1],
      path: match[2],
      baseBranch: match[3],
    });
  }

  return {
    title: titleMatch?.[1] ?? "Untitled",
    taskType: taskTypeMatch?.[1] ?? "unknown",
    ticketId: ticketIdMatch?.[1] ?? "",
    date: dateMatch?.[1] ?? "",
    repositories,
  };
}

export function parseConstraints(content: string): RepoConstraints[] {
  // Find the start of the ## Repository Constraints section
  const startMatch = content.match(/^## Repository Constraints\s*$/m);
  if (!startMatch) return [];

  const startIdx = startMatch.index! + startMatch[0].length;
  // Find the next ## or # heading (or end of string)
  const endMatch = content.slice(startIdx).match(/\n## |\n# /);
  const section = endMatch
    ? content.slice(startIdx, startIdx + endMatch.index!)
    : content.slice(startIdx);

  // Split by ### headings to get per-repo blocks
  const repoBlocks = section.split(/^### /m).slice(1); // skip text before first ###

  const results: RepoConstraints[] = [];
  const constraintPattern = /^\s*-\s+([\w][\w\s]*?):\s*`([^`]+)`/gm;

  for (const block of repoBlocks) {
    const repoName = block.split("\n")[0].trim();
    if (!repoName) continue;

    const constraints: RepoConstraint[] = [];
    let match;
    constraintPattern.lastIndex = 0;
    while ((match = constraintPattern.exec(block)) !== null) {
      constraints.push({ label: match[1].trim(), command: match[2] });
    }

    if (constraints.length > 0) {
      results.push({ repoName, constraints });
    }
  }

  return results;
}
