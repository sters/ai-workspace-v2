import fs from "node:fs";
import type { Operation, OperationEvent } from "@/types/operation";
import type { StoredHeader, StoredEvent } from "./types";
import { validateId, validateWorkspace, workspaceDir, operationFilePath } from "./constants";

/**
 * Write an operation log to disk as JSONL.
 * Stored at `.operations/{workspace}/{operationId}.jsonl`.
 * Line 1: header with operation metadata.
 * Lines 2..N: individual events.
 */
export function writeOperationLog(
  operation: Operation,
  events: OperationEvent[],
): void {
  if (!validateId(operation.id)) return;
  if (!validateWorkspace(operation.workspace)) return;

  const dir = workspaceDir(operation.workspace);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [];
  lines.push(JSON.stringify({ _type: "header", operation } satisfies StoredHeader));
  for (const event of events) {
    lines.push(JSON.stringify({ _type: "event", ...event } satisfies StoredEvent));
  }

  fs.writeFileSync(operationFilePath(operation.workspace, operation.id), lines.join("\n") + "\n");
}
