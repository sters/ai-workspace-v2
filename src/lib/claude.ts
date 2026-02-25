// Facade that delegates to CLI (Bun.spawn) or SDK based on env.
// Default: CLI. Set CLAUDE_USE_CLI=false to use the SDK.

import { runClaude as runCLI, type RunClaudeOptions } from "./claude-cli";
import { runClaude as runSDK } from "./claude-sdk";

const USE_CLI = process.env.CLAUDE_USE_CLI !== "false";

export function runClaude(operationId: string, prompt: string, options?: RunClaudeOptions) {
  return USE_CLI ? runCLI(operationId, prompt, options) : runSDK(operationId, prompt, options);
}

export type { ClaudeProcess } from "./claude-sdk";
export type { RunClaudeOptions } from "./claude-cli";
