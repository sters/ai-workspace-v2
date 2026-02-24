// Facade that delegates to CLI (Bun.spawn) or SDK based on env.
// Default: CLI. Set CLAUDE_USE_CLI=false to use the SDK.

import { runClaude as runCLI } from "./claude-cli";
import { runClaude as runSDK } from "./claude-sdk";

const USE_CLI = process.env.CLAUDE_USE_CLI !== "false";

export function runClaude(operationId: string, prompt: string) {
  return USE_CLI ? runCLI(operationId, prompt) : runSDK(operationId, prompt);
}

export type { ClaudeProcess } from "./claude-sdk";
