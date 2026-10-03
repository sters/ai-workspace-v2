/**
 * The notes written on the Pull Requests tab's selection, keyed by thread id or
 * check key. Kept in `sessionStorage` like the Changes tab's comments, so leaving
 * the tab and coming back keeps what was written.
 */

function storageKey(workspaceName: string): string {
  return `aiw-pr-notes:${workspaceName}`;
}

export function loadPrNotes(workspaceName: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey(workspaceName)) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function savePrNotes(workspaceName: string, notes: Record<string, string>): void {
  try {
    if (Object.keys(notes).length === 0) sessionStorage.removeItem(storageKey(workspaceName));
    else sessionStorage.setItem(storageKey(workspaceName), JSON.stringify(notes));
  } catch {
    // the notes just do not outlive the page
  }
}
