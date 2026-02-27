import type { PipelinePhase } from "@/types/pipeline";
import { buildMcpAuthPhase } from "./actions/mcp-auth";

export function buildMcpAuthPipeline(
  serverName: string,
  forceReauth: boolean,
): PipelinePhase[] {
  return [buildMcpAuthPhase(serverName, forceReauth)];
}
