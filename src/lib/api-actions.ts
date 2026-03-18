/**
 * Shared API action helpers for opening editors/terminals.
 * Used by operation-panel and repo-todo-card.
 */

import { postJson } from "./api-client";

export function openInEditor(targetPath: string) {
  return postJson("/api/operations/open-editor", { workspace: targetPath }).then(
    (result) => {
      if (!result.ok) console.error("Failed to open editor:", result.error);
    },
  );
}

export function openInTerminal(targetPath: string) {
  return postJson("/api/operations/open-terminal", { workspace: targetPath }).then(
    (result) => {
      if (!result.ok) console.error("Failed to open terminal:", result.error);
    },
  );
}
