import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { buildReadmeUpdaterPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { syncReadmeRepositories } from "./actions/ensure-repositories";
import { buildCriteriaFeasibilityPhase } from "./actions/criteria-feasibility";
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

  return [
    {
      kind: "single",
      label: "Update README",
      prompt,
      stepType: STEP_TYPES.UPDATE_README,
      addDirs: [workspacePath],
      allowedTools,
      appendSystemPromptFile: ensureSystemPrompt(workspacePath, "readme-updater"),
    },
    // After the README is updated, set up any repositories newly declared in it.
    // Best-effort: the README update itself has already succeeded, so repository
    // setup problems are reported but never fail the operation.
    {
      kind: "function",
      label: "Ensure repositories",
      timeoutMs: 10 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const res = await syncReadmeRepositories(workspace, ctx.emitStatus, ctx.signal);

        if (res.readError) {
          ctx.emitStatus(
            `Skipped repository setup — could not read README: ${res.readError}`,
          );
          return true;
        }
        if (res.setUp.length > 0) {
          ctx.emitResult(
            `Set up ${res.setUp.length} new repositor${res.setUp.length === 1 ? "y" : "ies"} from README: ${res.setUp.join(", ")}`,
          );
        }
        if (res.stillMissing.length > 0) {
          ctx.emitResult(
            `Could not set up: ${res.stillMissing.join(", ")}. Check the repository entries in README.md.`,
          );
        }
        return true;
      },
    },
    // This operation rewrites the `## Acceptance Criteria` the whole autonomous
    // flow treats as authoritative, which invalidates any earlier feasibility
    // verdict — and the autonomous run that follows only judges on its init
    // path, so this is where a rewritten contract gets checked. Runs after
    // repository setup because the judge reads every declared worktree.
    buildCriteriaFeasibilityPhase(workspace),
  ];
}
