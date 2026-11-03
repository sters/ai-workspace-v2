import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

/** One Claude CLI result: what a pipeline child cost. */
export interface ClaudeRunInput {
  operationId: string;
  operationType: string;
  workspace: string;
  phaseLabel: string | null;
  childLabel: string | null;
  /** Null for runs backfilled from event logs, which never recorded it. */
  stepType: string | null;
  effort: string | null;
  model: string | null;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface ClaudeRun extends ClaudeRunInput {
  id: number;
  createdAt: string;
}

let _insert: Statement | null = null;
let _listSince: Statement | null = null;

function stmts(db: Database) {
  _insert ??= db.prepare(`
    INSERT INTO claude_runs (operation_id, operation_type, workspace, phase_label, child_label, step_type, effort, model,
      cost_usd, duration_ms, num_turns, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
    VALUES ($operationId, $operationType, $workspace, $phaseLabel, $childLabel, $stepType, $effort, $model,
      $costUsd, $durationMs, $numTurns, $inputTokens, $cacheCreationTokens, $cacheReadTokens, $outputTokens)
  `);
  _listSince ??= db.prepare(`
    SELECT id, operation_id AS operationId, operation_type AS operationType, workspace, phase_label AS phaseLabel,
      child_label AS childLabel, step_type AS stepType, effort, model, cost_usd AS costUsd, duration_ms AS durationMs,
      num_turns AS numTurns, input_tokens AS inputTokens, cache_creation_tokens AS cacheCreationTokens,
      cache_read_tokens AS cacheReadTokens, output_tokens AS outputTokens, created_at AS createdAt
    FROM claude_runs WHERE created_at >= ? ORDER BY created_at
  `);
  return { insert: _insert, listSince: _listSince };
}

export function _resetClaudeRunStatements(): void {
  _insert = null;
  _listSince = null;
}

_onDbReset(_resetClaudeRunStatements);

export function insertClaudeRun(run: ClaudeRunInput): void {
  stmts(getDb()).insert.run({
    $operationId: run.operationId,
    $operationType: run.operationType,
    $workspace: run.workspace,
    $phaseLabel: run.phaseLabel,
    $childLabel: run.childLabel,
    $stepType: run.stepType,
    $effort: run.effort,
    $model: run.model,
    $costUsd: run.costUsd,
    $durationMs: run.durationMs,
    $numTurns: run.numTurns,
    $inputTokens: run.inputTokens,
    $cacheCreationTokens: run.cacheCreationTokens,
    $cacheReadTokens: run.cacheReadTokens,
    $outputTokens: run.outputTokens,
  });
}

export function listClaudeRuns(sinceIso: string): ClaudeRun[] {
  return stmts(getDb()).listSince.all(sinceIso) as ClaudeRun[];
}
