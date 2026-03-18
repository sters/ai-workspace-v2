/**
 * Shared API action helpers for opening editors/terminals.
 * Used by operation-panel and todo-updater.
 */

export function openInEditor(targetPath: string) {
  return fetch("/api/operations/open-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open editor:", data.error);
    }
  });
}

export function openInTerminal(targetPath: string) {
  return fetch("/api/operations/open-terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open terminal:", data.error);
    }
  });
}
