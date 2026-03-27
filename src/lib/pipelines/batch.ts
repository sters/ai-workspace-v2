import { getReviewSessions } from "@/lib/workspace/reader";
import { listWorkspaceRepos } from "@/lib/workspace";
import { getOperationConfig } from "@/lib/config";
import { buildInitPipeline } from "./init";
import { buildExecutePipeline } from "./execute";
import { buildReviewPipeline } from "./review";
import { buildCreatePrPipeline } from "./create-pr";
import { buildUpdateTodoPipeline } from "./update-todo";
import { buildBestOfNPipeline } from "./best-of-n";
import { runSubPhases } from "./actions/run-sub-phases";
import { resolveWorkspace } from "./actions/resolve-workspace";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

type BatchMode =
  | "execute-review"
  | "execute-pr"
  | "execute-review-pr-gated"
  | "execute-review-pr";

const DEFAULT_UPDATE_TODO_INSTRUCTION =
  "Update TODO item statuses to reflect current implementation progress.";

export function buildBatchPipeline(input: {
  mode: BatchMode;
  startWith: "init" | "update-todo" | "execute";
  description?: string;
  workspace?: string;
  instruction?: string;
  draft?: boolean;
  interactionLevel?: InteractionLevel;
  repo?: string;
  bestOfN?: number;
  bestOfNPhases?: ("execute" | "review" | "create-pr" | "update-todo")[];
}): PipelinePhase[] {
  const { mode, startWith, description, workspace, instruction, draft, interactionLevel, repo } = input;
  const bestOfNFromConfig = input.bestOfN == null;
  const bestOfNPhases = input.bestOfNPhases ?? ["execute"];
  /** Resolve effective bestOfN for a given operation type (explicit input > per-type config > global). */
  const resolveBestOfN = (type: "execute" | "review" | "create-pr" | "update-todo" | "init"): number =>
    input.bestOfN ?? getOperationConfig(type).bestOfN;
  const phases: PipelinePhase[] = [];

  // ------------------------------------------------------------------
  // Leading phases: init, update-todo, or skip straight to execute
  // ------------------------------------------------------------------

  if (startWith === "init") {
    // Inline all init phases — they share closures for wsName etc.
    const initBon = resolveBestOfN("init");
    const initPhases = buildInitPipeline(description ?? "", interactionLevel, {
      bestOfN: initBon >= 2 ? initBon : undefined,
      bestOfNConfirm: bestOfNFromConfig,
    });
    phases.push(...initPhases);
  } else if (startWith === "update-todo") {
    // update-todo: single phase built upfront
    phases.push({
      kind: "function",
      label: "Update TODOs",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        const ws = workspace!;
        const subPhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: instruction || DEFAULT_UPDATE_TODO_INSTRUCTION,
          repo,
          bestOfN: resolveBestOfN("update-todo") >= 2 && bestOfNPhases.includes("update-todo") ? resolveBestOfN("update-todo") : undefined,
          bestOfNConfirm: bestOfNFromConfig,
          interactionLevel,
        });
        return runSubPhases(ctx, subPhases);
      },
    });
  }
  // startWith === "execute": no leading phase, jump straight to execute

  // ------------------------------------------------------------------
  // Execute phase (always present)
  // ------------------------------------------------------------------

  phases.push({
    kind: "function",
    label: "Execute",
    timeoutMs: 25 * 60 * 1000,
    fn: async (ctx) => {
      const ws = resolveWorkspace(ctx.operationId, workspace);
      if (!ws) {
        ctx.emitStatus("No workspace found — cannot execute");
        return false;
      }
      ctx.emitStatus(`Executing workspace: ${ws}`);

      const execBon = resolveBestOfN("execute");
      if (execBon >= 2 && bestOfNPhases.includes("execute")) {
        const repos = listWorkspaceRepos(ws);
        const bonPhases = await buildBestOfNPipeline({
          workspace: ws,
          n: execBon,
          operationType: "execute",
          buildCandidatePhases: (candidateRepos) =>
            buildExecutePipeline({ workspace: ws, repos: candidateRepos }),
          repos,
          confirm: bestOfNFromConfig,
          buildNormalPhases: () => buildExecutePipeline({ workspace: ws, repository: repo }),
          interactionLevel,
        });
        return runSubPhases(ctx, bonPhases);
      }

      const subPhases = await buildExecutePipeline({ workspace: ws, repository: repo });
      return runSubPhases(ctx, subPhases);
    },
  });

  // ------------------------------------------------------------------
  // Review phase (unless mode is execute-pr)
  // ------------------------------------------------------------------

  const includeReview = mode !== "execute-pr";
  if (includeReview) {
    phases.push({
      kind: "function",
      label: "Review",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Reviewing workspace: ${ws}`);

        const revBon = resolveBestOfN("review");
        if (revBon >= 2 && bestOfNPhases.includes("review")) {
          const repos = listWorkspaceRepos(ws);
          const bonPhases = await buildBestOfNPipeline({
            workspace: ws,
            n: revBon,
            operationType: "review",
            buildCandidatePhases: (candidateRepos) =>
              buildReviewPipeline({ workspace: ws, repos: candidateRepos }),
            repos,
            confirm: bestOfNFromConfig,
            buildNormalPhases: () => buildReviewPipeline({ workspace: ws, repository: repo }),
            interactionLevel,
          });
          return runSubPhases(ctx, bonPhases);
        }

        const subPhases = await buildReviewPipeline({ workspace: ws, repository: repo });
        return runSubPhases(ctx, subPhases);
      },
    });
  }

  // ------------------------------------------------------------------
  // Gate check (only for execute-review-pr-gated)
  // ------------------------------------------------------------------

  let skipPr = false;

  if (mode === "execute-review-pr-gated") {
    phases.push({
      kind: "function",
      label: "Check review results",
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        const sessions = await getReviewSessions(ws);
        if (sessions.length === 0) {
          ctx.emitStatus("No review sessions found — skipping PR creation");
          skipPr = true;
          return true;
        }
        const latest = sessions[0]; // already sorted newest-first
        if (latest.critical > 0) {
          ctx.emitStatus(
            `Review found ${latest.critical} critical issue(s) — skipping PR creation`,
          );
          ctx.emitResult(
            `Review gate: **${latest.critical} critical issue(s)** detected. PR creation skipped.`,
          );
          skipPr = true;
        } else {
          ctx.emitStatus("Review passed — no critical issues, proceeding to PR");
        }
        return true;
      },
    });
  }

  // ------------------------------------------------------------------
  // Create PR phase (unless mode is execute-review)
  // ------------------------------------------------------------------

  const includePr = mode !== "execute-review";
  if (includePr) {
    phases.push({
      kind: "function",
      label: "Create PR",
      timeoutMs: 25 * 60 * 1000,
      fn: async (ctx) => {
        if (skipPr) {
          ctx.emitStatus("PR creation skipped due to review gate");
          return true;
        }
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Creating PR for workspace: ${ws}`);

        const prBon = resolveBestOfN("create-pr");
        if (prBon >= 2 && bestOfNPhases.includes("create-pr")) {
          const repos = listWorkspaceRepos(ws);
          const bonPhases = await buildBestOfNPipeline({
            workspace: ws,
            n: prBon,
            operationType: "create-pr",
            buildCandidatePhases: (candidateRepos) =>
              buildCreatePrPipeline({ workspace: ws, draft: draft !== false, repos: candidateRepos }),
            repos,
            confirm: bestOfNFromConfig,
            buildNormalPhases: () => buildCreatePrPipeline({ workspace: ws, draft: draft !== false, repository: repo }),
            interactionLevel,
          });
          return runSubPhases(ctx, bonPhases);
        }

        const subPhases = await buildCreatePrPipeline({
          workspace: ws,
          draft: draft !== false,
          repository: repo,
        });
        return runSubPhases(ctx, subPhases);
      },
    });
  }

  return phases;
}
