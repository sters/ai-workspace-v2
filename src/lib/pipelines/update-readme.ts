import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { buildReadmeUpdaterPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

export async function buildUpdateReadmePipeline(input: {
  workspace: string;
  instruction: string;
  interactionLevel?: InteractionLevel;
  interject?: boolean;
}): Promise<PipelinePhase[]> {
  const { workspace, instruction, interject } = input;
  const workspacePath = path.join(getWorkspaceDir(), workspace);

  const readmeFile = Bun.file(path.join(workspacePath, "README.md"));
  const readmeContent = (await readmeFile.exists())
    ? await readmeFile.text()
    : "";

  const prompt = buildReadmeUpdaterPrompt({
    workspaceName: workspace,
    readmeContent,
    workspacePath,
    instruction,
    ...(interject && { interject: true }),
  });

  const absPrefix = workspacePath.startsWith("/") ? "/" : "//";
  const allowedTools = [
    `Edit(${absPrefix}${workspacePath}/README.md)`,
    `Write(${absPrefix}${workspacePath}/README.md)`,
    "Bash(git:*)",
  ];

  return [{
    kind: "single",
    label: "Update README",
    prompt,
    stepType: STEP_TYPES.UPDATE_README,
    addDirs: [workspacePath],
    allowedTools,
    appendSystemPromptFile: ensureSystemPrompt(workspacePath, "readme-updater"),
  }];
}
