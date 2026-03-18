// Facade that delegates to CLI (Bun.spawn) or SDK based on config.
// Default: CLI. Set CLAUDE_USE_CLI=false or config claude.useCli=false to use the SDK.

import { runClaude as runCLI } from "./cli";
import { runClaude as runSDK } from "./sdk";
import type { RunClaudeOptions } from "@/types/claude";
import { getConfig } from "../config";

const USE_CLI = getConfig().claude.useCli;

export function runClaude(operationId: string, prompt: string, options?: RunClaudeOptions) {
  return USE_CLI ? runCLI(operationId, prompt, options) : runSDK(operationId, prompt, options);
}
