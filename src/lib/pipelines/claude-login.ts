import type { PipelinePhase } from "@/types/pipeline";
import { buildClaudeLoginPhase } from "./actions/claude-login";

export function buildClaudeLoginPipeline(): PipelinePhase[] {
  return [buildClaudeLoginPhase()];
}
