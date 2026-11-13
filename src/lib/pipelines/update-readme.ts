import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { buildReadmeUpdaterPrompt } from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import {
  syncReadmeRepositories,
  discoverConstraintsForNewRepos,
} from "./actions/ensure-repositories";
import { buildCriteriaFeasibilityPhase } from "./actions/criteria-feasibility";
import { scheduleAutonomousRekick, scheduleUpdateTodo } from "@/lib/pipeline/interject";
import { getReadme, getTodos } from "@/lib/workspace/reader";
import {
  buildReadmeFollowUpPrompt,
  README_FOLLOW_UP_PHASE_LABEL,
  README_FOLLOW_UP_SCHEMA,
} from "@/lib/templates/prompts/readme-follow-up";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

export async function buildUpdateReadmePipeline(input: {
  workspace: string;
  instruction: string;
  interactionLevel?: InteractionLevel;
  interject?: boolean;
  /** Inputs of the autonomous run this update interrupted; it is restarted afterwards. */
  interruptedAutonomous?: Record<string, string>;
}): Promise<PipelinePhase[]> {
  const { workspace, instruction, interject, interruptedAutonomous } = input;
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
      appendSystemPromptFile: await ensureSystemPrompt(workspacePath, "readme-updater"),
    },
    // After the README is updated, set up any repositories newly declared in it
    // and discover their constraints — the updater agent can only write the
    // README, and discovery needs to probe tool invocations in the worktree.
    // Best-effort: the README update itself has already succeeded, so repository
    // setup problems are reported but never fail the operation.
    {
      kind: "function",
      label: "Ensure repositories",
      // Covers a clone plus one constraint-discovery child per new repository.
      timeoutMs: 20 * 60 * 1000,
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
        if (!(await discoverConstraintsForNewRepos(ctx, workspace, res.setUpRepos))) {
          ctx.emitResult(
            "Constraint discovery did not complete for every new repository — check `## Repository Constraints` in README.md.",
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
    buildFollowUpPhase(workspace, workspacePath, instruction, readmeContent, interruptedAutonomous),
  ];
}

/**
 * Judges whether the updated README needs the TODOs re-planned and/or the
 * autonomous loop run, and schedules that to start once this operation
 * succeeds. An interrupted autonomous run is always restarted — only where it
 * restarts from is judged. With no verdict, an interrupted run restarts from
 * update-todo (re-planning against a changed contract is the safe side) and an
 * idle workspace is left alone.
 */
function buildFollowUpPhase(
  workspace: string,
  workspacePath: string,
  instruction: string,
  previousReadme: string,
  interruptedAutonomous: Record<string, string> | undefined,
): PipelinePhase {
  return {
    kind: "function",
    label: README_FOLLOW_UP_PHASE_LABEL,
    timeoutMs: 10 * 60 * 1000,
    maxRetries: 0,
    fn: async (ctx) => {
      if (ctx.signal.aborted) return false;

      const todos = await Promise.all(
        (await getTodos(workspace)).map(async (t) => ({
          filename: t.filename,
          content: await Bun.file(path.join(workspacePath, t.filename)).text(),
        })),
      );

      let resultText = "";
      const ok = await ctx.runChild(
        "README Follow-up",
        buildReadmeFollowUpPrompt({
          workspaceName: workspace,
          instruction,
          previousReadme,
          currentReadme: (await getReadme(workspace)) ?? "",
          todos,
        }),
        {
          jsonSchema: README_FOLLOW_UP_SCHEMA,
          stepType: STEP_TYPES.README_FOLLOW_UP,
          appendSystemPromptFile: await ensureSystemPrompt(workspacePath, "readme-follow-up"),
          onResultText: (text) => { resultText = text; },
          skipAskUserQuestion: true,
        },
      );

      let verdict: { updateTodo: boolean; autonomous: boolean; reason: string } | undefined;
      if (ok && resultText) {
        try {
          const parsed = JSON.parse(resultText);
          if (typeof parsed.updateTodo === "boolean" && typeof parsed.autonomous === "boolean") {
            verdict = {
              updateTodo: parsed.updateTodo,
              autonomous: parsed.autonomous,
              reason: typeof parsed.reason === "string" ? parsed.reason : "",
            };
          }
        } catch {
          // handled as no verdict
        }
      }

      const updateTodo = verdict ? verdict.updateTodo : interruptedAutonomous != null;
      const autonomous = interruptedAutonomous != null || (verdict?.autonomous ?? false);
      const reason = verdict?.reason ? ` ${verdict.reason}` : "";
      const todoInstruction =
        `The README was updated (${instruction}).${reason} Re-plan the TODO items to match the updated README.`;

      if (autonomous) {
        const startWith = updateTodo ? "update-todo" : "execute";
        const inputs = { ...(interruptedAutonomous ?? {}) };
        if (updateTodo) inputs.instruction = todoInstruction;
        scheduleAutonomousRekick(ctx.operationId, workspace, inputs, startWith);
        ctx.emitResult(`**Autonomous will start from ${startWith} once this update completes.**${reason}`);
      } else if (updateTodo) {
        scheduleUpdateTodo(ctx.operationId, workspace, todoInstruction);
        ctx.emitResult(`**TODOs will be re-planned once this update completes.**${reason}`);
      } else {
        ctx.emitResult(
          verdict
            ? `**No follow-up needed.**${reason}`
            : "Follow-up judge returned no verdict — no follow-up started.",
        );
      }
      return true;
    },
  };
}
