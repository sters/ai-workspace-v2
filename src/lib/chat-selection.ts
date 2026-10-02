/**
 * Ranges of the Changes tab's diffs collected to talk about in the chat, and
 * the opening message they become.
 */

export interface ChatSelection {
  id: string;
  /** The worktree, relative to the workspace directory. */
  repoPath: string;
  /** Relative to the worktree. */
  filePath: string;
  oldRange: [number, number] | null;
  newRange: [number, number] | null;
  /** The selected diff lines, markers included. */
  text: string;
}

function lines([start, end]: [number, number]): string {
  return start === end ? `line ${start}` : `lines ${start}-${end}`;
}

export function locateSelection(selection: ChatSelection): string {
  const where = `${selection.repoPath}/${selection.filePath}`;
  if (selection.newRange) return `${where}, ${lines(selection.newRange)}`;
  if (selection.oldRange) return `${where}, removed ${lines(selection.oldRange)} of the base version`;
  return where;
}

/** A fence longer than any backtick run in the quoted text, so it cannot close early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** The opening message of a discussion chat about these selections. */
export function buildSelectionTopic(selections: ChatSelection[]): string {
  const parts = selections.map((selection, i) => {
    const fence = fenceFor(selection.text);
    return `${i + 1}. ${locateSelection(selection)}\n${fence}diff\n${selection.text}\n${fence}`;
  });
  return [
    "About these parts of this workspace's changes (each worktree diffed against its base branch; paths are relative to the workspace directory):",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

function storageKey(workspaceId: string): string {
  return `aiw-chat-selections:${workspaceId}`;
}

/** The collected selections survive switching tabs, not closing the browser tab. */
export function loadChatSelections(workspaceId: string): ChatSelection[] {
  try {
    const raw = sessionStorage.getItem(storageKey(workspaceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChatSelections(workspaceId: string, selections: ChatSelection[]): void {
  try {
    if (selections.length === 0) sessionStorage.removeItem(storageKey(workspaceId));
    else sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(selections));
  } catch {
    // the selections just do not outlive the page
  }
}
