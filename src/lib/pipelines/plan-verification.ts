/**
 * `plan-verification` — drafts the Verify tab's scenarios, or rewrites the
 * remainder of one that stopped (`scenarioId`). The only part of verification
 * that needs a model; the steps themselves are run by
 * `src/lib/verification/runner.ts`, outside the orchestrator.
 */

import path from "node:path";
import { READ_ONLY_TOOLS } from "@/lib/claude/read-only-tools";
import { getWorkspaceDir } from "@/lib/config";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { verificationPlanSchema } from "@/lib/runtime-schemas";
import {
  buildVerificationPlannerPrompt,
  VERIFICATION_PLAN_SCHEMA,
} from "@/lib/templates/prompts/verification-planner";
import { replaceRemainingSteps } from "@/lib/verification/runner";
import { createScenarios, listScenarios, readScenario } from "@/lib/verification/store";
import { detectBaseBranch, getRepoChanges, listWorkspaceRepos } from "@/lib/workspace";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { getReadme } from "@/lib/workspace/reader";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";

export function buildPlanVerificationPipeline(input: {
  workspace: string;
  scenarioId?: string;
  instruction?: string;
}): PipelinePhase[] {
  const { workspace, scenarioId, instruction } = input;
  return [{
    kind: "function",
    label: scenarioId ? "Replan verification scenario" : "Plan verification scenarios",
    timeoutMs: 20 * 60 * 1000,
    maxRetries: 0,
    fn: async (ctx) => {
      const wsPath = path.join(getWorkspaceDir(), workspace);
      const readmeContent = (await getReadme(workspace)) ?? "";
      const meta = parseReadmeMeta(readmeContent);
      const repos = await listWorkspaceRepos(workspace);

      const scenario = scenarioId ? await readScenario(wsPath, scenarioId) : null;
      if (scenarioId && !scenario) {
        ctx.emitResult(`Scenario not found: ${scenarioId}`);
        return false;
      }

      const repoInputs = await Promise.all(repos.map(async (repo) => {
        const metaRepo = meta.repositories.find((r) => r.path === repo.repoPath || r.alias === repo.repoName);
        const baseBranch = metaRepo?.baseBranch ?? (await detectBaseBranch(repo.worktreePath));
        const c = await getRepoChanges(workspace, repo.repoPath, baseBranch);
        return {
          repoName: repo.repoName,
          worktreePath: repo.worktreePath,
          baseBranch,
          changes: `Branch: ${c.currentBranch}\n\nChanged files:\n${c.changedFiles}\n\nDiff stat:\n${c.diffStat}\n\nCommit log:\n${c.commitLog}`,
        };
      }));

      let resultText = "";
      const ok = await ctx.runChild(
        "Verification planner",
        buildVerificationPlannerPrompt({
          workspaceName: workspace,
          workspacePath: wsPath,
          readmeContent,
          repos: repoInputs,
          existingTitles: scenario ? [] : (await listScenarios(wsPath)).map((s) => s.title),
          instruction,
          ...(scenario && { replan: { scenarioJson: JSON.stringify(scenario, null, 2) } }),
        }),
        {
          jsonSchema: VERIFICATION_PLAN_SCHEMA as unknown as Record<string, unknown>,
          stepType: STEP_TYPES.PLAN_VERIFICATION,
          addDirs: [wsPath, ...repos.map((r) => r.worktreePath)],
          allowedTools: READ_ONLY_TOOLS,
          appendSystemPromptFile: await ensureSystemPrompt(wsPath, "verification-planner"),
          onResultText: (text) => { resultText = text; },
          skipAskUserQuestion: true,
        },
      );
      if (!ok || !resultText) {
        ctx.emitResult("The planner returned no plan.");
        return false;
      }

      let json: unknown;
      try {
        json = JSON.parse(resultText);
      } catch {
        ctx.emitResult("The planner's plan is not valid JSON.");
        return false;
      }
      const parsed = verificationPlanSchema.safeParse(json);
      if (!parsed.success) {
        ctx.emitResult(`The planner's plan is not usable:\n${parsed.error.issues.map((i) => `- ${i.message}`).join("\n")}`);
        return false;
      }
      const plan = parsed.data;

      if (scenario) {
        if (plan.scenarios.length !== 1) {
          ctx.emitResult(`Expected one rewritten scenario, got ${plan.scenarios.length}.`);
          return false;
        }
        const replaced = await replaceRemainingSteps(wsPath, scenario.id, plan.scenarios[0].steps, scenario.revision + 1);
        if (!replaced.ok) {
          ctx.emitResult(replaced.error);
          return false;
        }
        ctx.emitResult(`**Rewrote the remaining steps of "${scenario.title}"** (${plan.scenarios[0].steps.length} steps). Open the Verify tab to continue.`);
        return true;
      }

      if (plan.scenarios.length === 0) {
        ctx.emitResult("**No verification scenarios** — the planner found nothing a running check would add.");
        return true;
      }
      const created = await createScenarios(wsPath, plan.scenarios);
      ctx.emitResult(
        `**Planned ${created.length} verification scenario${created.length === 1 ? "" : "s"}.** Open the Verify tab to review and run them.\n` +
          created.map((s) => `- ${s.title} (${s.steps.length} steps)`).join("\n"),
      );
      return true;
    },
  }];
}
