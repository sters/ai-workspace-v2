import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { parseAcceptanceCriteria } from "@/lib/parsers/readme";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { appendKnownFindings } from "@/lib/workspace/known-findings";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { getReadme } from "@/lib/workspace/reader";
import {
  buildCriteriaFeasibilityPrompt,
  CRITERIA_FEASIBILITY_PHASE_LABEL,
  CRITERIA_FEASIBILITY_SCHEMA,
} from "@/lib/templates/prompts/criteria-feasibility";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PhaseFunctionContext, PipelinePhase } from "@/types/pipeline";

/**
 * Acceptance-criteria feasibility check: records `(auto)` criteria that no change
 * in these repositories can satisfy in the known-findings ledger, so the
 * reviewers stop re-deriving them and the autonomous gate stops looping toward
 * them. Never stops the run — the rest of the contract is still worth building.
 *
 * It runs where the criteria are *written*, not on every run that reads them:
 * as a sibling of the README clarity judge on the autonomous init path, and as a
 * phase of `update-readme`. A run that merely re-reads an already-judged
 * contract (autonomous starting from execute / update-todo, e.g. a PR-review
 * turnaround) was paying a full worktree-reading judge for a verdict it already
 * had in the ledger.
 *
 * Split into a child spec plus the code that applies its verdict so it can run
 * either inside another phase's `runChildGroup` or as its own phase. Returns
 * null when there is nothing to judge, which is the caller's cue to skip the
 * child entirely.
 */
export async function prepareCriteriaFeasibility(ws: string): Promise<{
  child: GroupChild;
  apply: (ctx: PhaseFunctionContext, ok: boolean) => Promise<void>;
} | null> {
  const readmeContent = (await getReadme(ws)) ?? "";
  const criteria = parseAcceptanceCriteria(readmeContent);
  const autoCriteria = criteria.filter((c) => c.kind === "auto");
  if (autoCriteria.length === 0) return null;

  const wsPath = path.join(getWorkspaceDir(), ws);
  const repos = listWorkspaceRepos(ws);
  let resultText = "";

  const child: GroupChild = {
    label: "Criteria Feasibility",
    prompt: buildCriteriaFeasibilityPrompt({
      workspaceName: ws,
      readmeContent,
      acceptanceCriteria: criteria
        .map((c) => `- [${c.checked ? "x" : " "}] (${c.kind}) ${c.text}`)
        .join("\n"),
      repos: repos.map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
    }),
    jsonSchema: CRITERIA_FEASIBILITY_SCHEMA,
    stepType: STEP_TYPES.CRITERIA_FEASIBILITY,
    addDirs: repos.map((r) => r.worktreePath),
    appendSystemPromptFile: ensureSystemPrompt(wsPath, "criteria-feasibility"),
    onResultText: (text) => { resultText = text; },
    skipAskUserQuestion: true,
  };

  const apply = async (ctx: PhaseFunctionContext, ok: boolean) => {
    // Fail open in both directions: a judge hiccup must not stop the run, and
    // must not silently mark anything unachievable either.
    if (!ok || !resultText) {
      ctx.emitStatus("Feasibility check returned no verdict — proceeding with all criteria");
      return;
    }

    let parsed: { infeasible?: unknown; reason?: unknown };
    try {
      parsed = JSON.parse(resultText);
    } catch {
      ctx.emitStatus("Could not parse feasibility verdict — proceeding with all criteria");
      return;
    }

    const infeasible = Array.isArray(parsed.infeasible)
      ? parsed.infeasible.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return [];
          const { criterion, reason } = entry as Record<string, unknown>;
          if (typeof criterion !== "string" || criterion.trim() === "") return [];
          return [{ criterion, reason: typeof reason === "string" ? reason : "" }];
        })
      : [];

    if (infeasible.length === 0) {
      ctx.emitResult(
        `**All ${autoCriteria.length} \`(auto)\` acceptance criteria are achievable in these repositories.**` +
          (typeof parsed.reason === "string" && parsed.reason ? ` ${parsed.reason}` : ""),
      );
      return;
    }

    const added = await appendKnownFindings(
      wsPath,
      infeasible.map((i) => ({
        kind: "infeasible" as const,
        summary: `Acceptance criterion cannot be satisfied in these repositories: ${i.criterion}`,
        reason: i.reason,
      })),
    );

    ctx.emitResult(
      `**${infeasible.length} of ${autoCriteria.length} \`(auto)\` acceptance criteria cannot be satisfied in these repositories.**\n` +
        infeasible.map((i) => `- ${i.criterion}\n  - ${i.reason}`).join("\n") +
        `\n\nRecorded ${added.length} entr${added.length === 1 ? "y" : "ies"} in \`artifacts/known-findings.md\` so review and gate phases stop looping toward them. ` +
        "The run continues on the remaining criteria; resolve these by updating the README (Non-Goal / Acceptance Criteria) or by taking them up with the owning repository.",
    );
  };

  return { child, apply };
}

/**
 * The feasibility judge as a standalone phase, for pipelines that rewrite the
 * `(auto)` criteria and so invalidate any earlier verdict.
 */
export function buildCriteriaFeasibilityPhase(workspace: string): PipelinePhase {
  return {
    kind: "function",
    label: CRITERIA_FEASIBILITY_PHASE_LABEL,
    timeoutMs: 15 * 60 * 1000,
    maxRetries: 0,
    fn: async (ctx) => {
      if (ctx.signal.aborted) return false;

      const judge = await prepareCriteriaFeasibility(workspace);
      if (!judge) {
        ctx.emitStatus("No (auto) acceptance criteria to check — skipping");
        return true;
      }

      const { label, prompt, ...opts } = judge.child;
      const ok = await ctx.runChild(label, prompt, opts);
      await judge.apply(ctx, ok);
      return true;
    },
  };
}
