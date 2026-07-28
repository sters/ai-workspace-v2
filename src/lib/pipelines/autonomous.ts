import { getReviewSessions, getReviewDetail, getTodos, getReadme } from "@/lib/workspace/reader";
import { stripCompletedTodosFromWorkspace } from "@/lib/workspace/todo-cleanup";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme, parseAcceptanceCriteria } from "@/lib/parsers/readme";
import { syncReadmeRepositories } from "./actions/ensure-repositories";
import { buildInitTodoAnalysisPhases } from "./actions/init-todo-analysis";
import { buildInitPipeline } from "./init";
import { buildExecutePipeline } from "./execute";
import { buildReviewPipeline } from "./review";
import { buildCreatePrPipeline } from "./create-pr";
import { buildUpdateTodoPipeline } from "./update-todo";
import { runSubPhases } from "./actions/run-sub-phases";
import { resolveWorkspace } from "./actions/resolve-workspace";
import { buildAutonomousGatePrompt, AUTONOMOUS_GATE_SCHEMA } from "@/lib/templates/prompts/autonomous-gate";
import { buildReadmeClarityGatePrompt, README_CLARITY_GATE_SCHEMA, README_CLARITY_PHASE_LABEL, README_CLARITY_STOP_PREFIX } from "@/lib/templates/prompts/readme-clarity-gate";
import { prepareCriteriaFeasibility } from "./actions/criteria-feasibility";
import { getWorkspaceDir } from "@/lib/config";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import {
  appendKnownFindings,
  normalizeKnownFindingKind,
  readKnownFindings,
} from "@/lib/workspace/known-findings";
import type { KnownFinding } from "@/lib/workspace/known-findings";
import path from "node:path";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, PipelinePhase, PhaseFunctionContext } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";

const DEFAULT_MAX_LOOPS = 10;

const DEFAULT_UPDATE_TODO_INSTRUCTION =
  "Update TODO item statuses to reflect current implementation progress.";

/**
 * Wall-clock budgets for the cycle phases.
 *
 * Each cycle phase runs a whole sub-pipeline through `runSubPhases`, which
 * **ignores** the sub-phases' own `timeoutMs` — so the budget here is the only
 * one that applies, and it has to cover every sub-phase end to end, not just
 * the slowest one. A wrapper tighter than the pipeline it wraps fires first and
 * makes the sub-pipeline's own budgeting dead code.
 *
 * These are deliberately generous rather than tuned: overshooting costs nothing
 * (a phase that finishes early just proceeds), while undershooting is expensive
 * twice over, because `execute-phases.ts` retries a timed-out phase on the same
 * budget — so it times out again, up to `maxRetries` times, re-running every
 * Claude child from scratch each time.
 */
const CYCLE_BUDGETS_MS = {
  /** `execute.ts` budgets `maxBatches * 20min + 5min`; batch count is unknown until run time, 3 is routine. */
  execute: 70 * 60 * 1000,
  /** `review.ts`: reviewer group (scales with repo count) + constraints (10min) + collect (20min). */
  review: 45 * 60 * 1000,
  /** One `autonomous-gate` child over the review summary; measured well under a minute. */
  gate: 10 * 60 * 1000,
  /** `update-todo.ts`: one updater child, plus up to 60min on the best-of-N path. */
  updateTodo: 30 * 60 * 1000,
} as const;

interface AutonomousGateResult {
  shouldLoop: boolean;
  giveUp: boolean;
  reason: string;
  fixableIssues: string[];
  /** Findings the gate deliberately did not act on, for the known-findings ledger. */
  dismissedFindings: KnownFinding[];
}

function settled(reason: string): AutonomousGateResult {
  return { shouldLoop: false, giveUp: false, reason, fixableIssues: [], dismissedFindings: [] };
}

function parseDismissedFindings(raw: unknown): KnownFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { summary, reason, kind } = entry as Record<string, unknown>;
    if (typeof summary !== "string" || summary.trim() === "") return [];
    return [{
      summary,
      reason: typeof reason === "string" ? reason : "",
      kind: normalizeKnownFindingKind(typeof kind === "string" ? kind : undefined),
    }];
  });
}

async function runAutonomousGate(
  ctx: PhaseFunctionContext,
  workspace: string,
  loopIteration: number,
  maxLoops: number,
  previousGateResults?: { cycle: number; reason: string; fixableIssues: string[] }[],
): Promise<AutonomousGateResult> {
  // Final iteration: skip AI call
  if (loopIteration >= maxLoops) {
    return settled("Maximum loop iterations reached");
  }

  // Check review results
  const sessions = await getReviewSessions(workspace);
  if (sessions.length === 0) {
    return settled("No review sessions found");
  }

  const latest = sessions[0];

  // Always let AI evaluate — even warnings/suggestions may be worth fixing
  const reviewDetail = await getReviewDetail(workspace, latest.timestamp);
  if (!reviewDetail) {
    return settled("Could not read review details");
  }

  // Get TODO files
  const todoSummaries = await getTodos(workspace);
  const todoFiles: { repoName: string; content: string }[] = [];
  for (const todo of todoSummaries) {
    const todoPath = path.join(getWorkspaceDir(), workspace, todo.filename);
    try {
      const content = await Bun.file(todoPath).text();
      todoFiles.push({ repoName: todo.repoName, content });
    } catch {
      // skip unreadable TODO files
    }
  }

  // Get README
  const readmeContent = (await getReadme(workspace)) ?? "";
  const acceptanceCriteria = parseAcceptanceCriteria(readmeContent)
    .map((c) => `- [${c.checked ? "x" : " "}] (${c.kind}) ${c.text}`)
    .join("\n");

  const wsPath = path.join(getWorkspaceDir(), workspace);

  // Build gate prompt
  const prompt = buildAutonomousGatePrompt({
    workspaceName: workspace,
    reviewSummary: reviewDetail.summary,
    reviewFiles: reviewDetail.files,
    todoFiles,
    readmeContent,
    acceptanceCriteria,
    loopIteration,
    maxLoops,
    previousGateResults,
    knownFindings: await readKnownFindings(wsPath),
  });

  // Run AI gate
  let resultText = "";
  const ok = await ctx.runChild("Autonomous Gate", prompt, {
    jsonSchema: AUTONOMOUS_GATE_SCHEMA,
    stepType: STEP_TYPES.AUTONOMOUS_GATE,
    appendSystemPromptFile: ensureSystemPrompt(wsPath, "autonomous-gate"),
    onResultText: (text) => { resultText = text; },
    skipAskUserQuestion: true,
  });

  if (!ok || !resultText) {
    return settled("Gate execution failed");
  }

  // Parse result
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>;
    if (typeof parsed.shouldLoop !== "boolean") {
      return settled("Invalid gate response");
    }
    return {
      shouldLoop: parsed.shouldLoop,
      giveUp: parsed.giveUp === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      fixableIssues: Array.isArray(parsed.fixableIssues)
        ? parsed.fixableIssues.filter((i): i is string => typeof i === "string")
        : [],
      dismissedFindings: parseDismissedFindings(parsed.dismissedFindings),
    };
  } catch {
    return settled("Failed to parse gate response");
  }
}

export function buildAutonomousPipeline(input: {
  startWith: "init" | "update-todo" | "execute";
  description?: string;
  workspace?: string;
  instruction?: string;
  draft?: boolean;
  interactionLevel?: InteractionLevel;
  repo?: string;
  maxLoops?: number;
  /** For resume: pre-generate cycle phases matching the saved structure. */
  resumeCycles?: { cycle: number; hasUpdateTodo: boolean }[];
  /** For resume: append a Create PR phase to match the saved phase structure. */
  resumeWithCreatePr?: boolean;
  /** For resume: prepend the Ensure repositories phase if it was in the saved structure. */
  resumeWithEnsureRepos?: boolean;
  /** For resume: prepend the Ensure TODOs phase if it was in the saved structure. */
  resumeWithEnsureTodos?: boolean;
}): PipelinePhase[] {
  const { startWith, description, workspace, instruction, draft, interactionLevel, repo } = input;
  const maxLoops = input.maxLoops ?? DEFAULT_MAX_LOOPS;
  const phases: PipelinePhase[] = [];
  const skip = { skipAskUserQuestion: true } as const;
  const gateHistory: { cycle: number; reason: string; fixableIssues: string[] }[] = [];
  // For a fresh `init` run, gate the first cycle behind a README clarity check
  // instead of queueing it upfront: the check appends the cycle only when the
  // drafted README is a clear enough "done" contract to implement autonomously.
  const initClarityGated = startWith === "init" && !input.resumeCycles;

  // ------------------------------------------------------------------
  // Leading phases: init, update-todo, or skip straight to execute
  // ------------------------------------------------------------------

  function buildEnsureRepositoriesPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Ensure repositories",
      timeoutMs: 10 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot ensure repositories");
          return false;
        }

        const res = await syncReadmeRepositories(ws, ctx.emitStatus, ctx.signal);

        if (res.readError) {
          ctx.emitResult(`Failed to read README: ${res.readError}`);
          return false;
        }

        if (res.metaRepoCount === 0) {
          if (res.existingCount > 0) {
            // Workspace has worktrees but README is missing entries — proceed,
            // executor will use what's on disk.
            ctx.emitStatus(
              `README has no repository entries, but ${res.existingCount} worktree(s) on disk`,
            );
            return true;
          }
          ctx.emitResult(
            "README has no repository entries. Add repositories to README.md and retry.",
          );
          return false;
        }

        if (res.stillMissing.length > 0) {
          ctx.emitResult(
            `Failed to set up: ${res.stillMissing.join(", ")}. Check README.md and try again.`,
          );
          return false;
        }

        if (res.setUp.length > 0) {
          ctx.emitResult(
            `Set up ${res.setUp.length} repositor${res.setUp.length === 1 ? "y" : "ies"}: ${res.setUp.join(", ")}`,
          );
        } else {
          ctx.emitStatus(
            `All ${res.metaRepoCount} README repositor${res.metaRepoCount === 1 ? "y" : "ies"} already set up`,
          );
        }
        return true;
      },
    };
  }

  function buildEnsureTodosPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Ensure TODOs",
      timeoutMs: 60 * 60 * 1000, // Plan TODO sub-phase may wait for human interaction
      maxRetries: 0,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot ensure TODOs");
          return false;
        }

        const wsPath = path.join(getWorkspaceDir(), ws);
        const repos = listWorkspaceRepos(ws);
        if (repos.length === 0) {
          ctx.emitResult(
            "No repositories in workspace — cannot plan TODOs. Run Ensure repositories first.",
          );
          return false;
        }

        const existing = await getTodos(ws);
        const existingTodoRepos = new Set(existing.map((t) => t.repoName));
        const missing = repos.filter((r) => !existingTodoRepos.has(r.repoName));

        if (missing.length === 0) {
          ctx.emitStatus(
            `TODO files present for all ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`,
          );
          return true;
        }

        let taskType = "";
        try {
          const { meta } = await readWorkspaceReadme(wsPath);
          taskType = meta.taskType;
        } catch (err) {
          ctx.emitStatus(`Warning: failed to read README: ${err}`);
        }

        ctx.emitStatus(
          `Missing TODO files for ${missing.length} repositor${missing.length === 1 ? "y" : "ies"}: ${missing.map((r) => r.repoName).join(", ")}`,
        );

        const subPhases = buildInitTodoAnalysisPhases({
          wsName: () => ws,
          wsPath: () => wsPath,
          repos: () => missing.map((r) => ({
            repoPath: r.repoPath,
            repoName: r.repoName,
            worktreePath: r.worktreePath,
          })),
          taskType: () => taskType,
          interactionLevel,
          commitMessage: "Recover: workspace TODO analysis completed",
          commitResultMessage: `Workspace **${ws}** TODO analysis recovered.`,
        });

        return runSubPhases(ctx, subPhases, skip);
      },
    };
  }

  if (startWith === "init") {
    const initPhases = buildInitPipeline(description ?? "", interactionLevel);
    phases.push(...initPhases);
    if (initClarityGated) {
      phases.push(buildReadmeClarityGatePhase());
    }
  } else {
    // Prepend salvage phases for non-init paths.
    // On resume, only include them if the saved phase structure had them.
    if (!input.resumeCycles || input.resumeWithEnsureRepos) {
      phases.push(buildEnsureRepositoriesPhase());
    }
    if (!input.resumeCycles || input.resumeWithEnsureTodos) {
      phases.push(buildEnsureTodosPhase());
    }
  }

  if (startWith === "update-todo") {
    phases.push({
      kind: "function",
      label: "Update TODOs",
      timeoutMs: CYCLE_BUDGETS_MS.updateTodo,
      fn: async (ctx) => {
        const ws = workspace!;
        const stripped = await stripCompletedTodosFromWorkspace(ws, repo);
        if (stripped.length > 0) {
          ctx.emitStatus(`Removed completed TODO items from: ${stripped.join(", ")}`);
        }
        const subPhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: instruction || DEFAULT_UPDATE_TODO_INSTRUCTION,
          repo,
          interactionLevel,
        });
        return runSubPhases(ctx, subPhases, skip);
      },
    });
  }

  // ------------------------------------------------------------------
  // Autonomous cycle: each step is its own top-level phase
  // ------------------------------------------------------------------

  function buildCycleExecutePhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Execute`,
      timeoutMs: CYCLE_BUDGETS_MS.execute,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot execute");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Executing workspace: ${ws}`);
        const execPhases = await buildExecutePipeline({ workspace: ws, repository: repo });
        return runSubPhases(ctx, execPhases, skip);
      },
    };
  }

  function buildCycleReviewPhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Review`,
      timeoutMs: CYCLE_BUDGETS_MS.review,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot review");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Reviewing workspace: ${ws}`);
        const reviewPhases = await buildReviewPipeline({ workspace: ws, repository: repo });
        return runSubPhases(ctx, reviewPhases, skip);
      },
    };
  }

  function buildCycleGatePhase(loopNumber: number): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Gate`,
      timeoutMs: CYCLE_BUDGETS_MS.gate,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot evaluate");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Evaluating review results`);
        const gateResult = await runAutonomousGate(ctx, ws, loopNumber, maxLoops, gateHistory);
        gateHistory.push({ cycle: loopNumber, reason: gateResult.reason, fixableIssues: gateResult.fixableIssues });

        // Record what the gate declined to act on. Without this the next cycle's
        // reviewers re-derive and re-report it at full length, and this gate
        // spends another decision reaching the same conclusion.
        if (gateResult.dismissedFindings.length > 0) {
          const added = await appendKnownFindings(
            path.join(getWorkspaceDir(), ws),
            gateResult.dismissedFindings.map((f) => ({ ...f, cycle: loopNumber })),
          );
          if (added.length > 0) {
            ctx.emitStatus(
              `Recorded ${added.length} accepted finding${added.length === 1 ? "" : "s"} in artifacts/known-findings.md`,
            );
          }
        }

        const decisionLabel = gateResult.giveUp
          ? "Give up"
          : gateResult.shouldLoop
            ? "Continue"
            : "Proceed to PR";
        ctx.emitResult(
          `**Gate decision (cycle ${loopNumber}/${maxLoops})**: ${decisionLabel} — ${gateResult.reason}` +
            (gateResult.fixableIssues.length > 0
              ? `\n- ${gateResult.fixableIssues.join("\n- ")}`
              : ""),
        );

        if (gateResult.giveUp) {
          return true;
        }

        if (!gateResult.shouldLoop) {
          ctx.appendPhases([buildCreatePrPhase()]);
          return true;
        }

        // Append: Update TODO for this cycle + next cycle's 3 phases
        ctx.appendPhases([
          buildCycleUpdateTodoPhase(loopNumber, gateResult.fixableIssues),
          buildCycleExecutePhase(loopNumber + 1),
          buildCycleReviewPhase(loopNumber + 1),
          buildCycleGatePhase(loopNumber + 1),
        ]);
        return true;
      },
    };
  }

  function buildCycleUpdateTodoPhase(loopNumber: number, fixableIssues: string[]): PipelinePhase {
    return {
      kind: "function",
      label: `Cycle ${loopNumber}: Update TODO`,
      timeoutMs: CYCLE_BUDGETS_MS.updateTodo,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot update TODOs");
          return false;
        }
        ctx.emitStatus(`Cycle ${loopNumber}/${maxLoops}: Updating TODOs for next iteration`);
        const stripped = await stripCompletedTodosFromWorkspace(ws, repo);
        if (stripped.length > 0) {
          ctx.emitStatus(`Removed completed TODO items from: ${stripped.join(", ")}`);
        }
        const updateInstruction =
          fixableIssues.length > 0
            ? `Fix the following issues found in review:\n${fixableIssues.map((i) => `- ${i}`).join("\n")}`
            : DEFAULT_UPDATE_TODO_INSTRUCTION;
        const updatePhases = await buildUpdateTodoPipeline({
          workspace: ws,
          instruction: updateInstruction,
          repo,
          interactionLevel,
        });
        return runSubPhases(ctx, updatePhases, skip);
      },
    };
  }

  // README clarity gate (init path only): decide whether the drafted README is
  // a clear enough contract to implement autonomously. If yes, append cycle 1.
  // If too vague, stop the run and recommend the human refine it via update-readme.
  //
  // The criteria-feasibility judge runs as a second child of this same phase
  // rather than as a phase behind it. Both read only the drafted README (plus,
  // for feasibility, the worktrees) and ask independent questions of it — is the
  // contract clear, and is each `(auto)` criterion achievable here — so running
  // them in sequence bought nothing but wall clock. This phase keeps
  // `README_CLARITY_PHASE_LABEL` so the Slack notifier still finds the stop
  // message by phase label.
  function buildReadmeClarityGatePhase(): PipelinePhase {
    return {
      kind: "function",
      label: README_CLARITY_PHASE_LABEL,
      // Sized to the slower of the two judges, not their sum — they run together.
      timeoutMs: 15 * 60 * 1000,
      maxRetries: 0,
      fn: async (ctx) => {
        if (ctx.signal.aborted) return false;
        const ws = resolveWorkspace(ctx.operationId, workspace);
        if (!ws) {
          ctx.emitStatus("No workspace found — cannot analyze README clarity");
          return false;
        }

        const readmeContent = (await getReadme(ws)) ?? "";
        const acceptanceCriteria = parseAcceptanceCriteria(readmeContent)
          .map((c) => `- [${c.checked ? "x" : " "}] (${c.kind}) ${c.text}`)
          .join("\n");

        const wsPath = path.join(getWorkspaceDir(), ws);
        let resultText = "";
        const clarityChild: GroupChild = {
          label: "README Clarity Gate",
          prompt: buildReadmeClarityGatePrompt({ workspaceName: ws, readmeContent, acceptanceCriteria }),
          jsonSchema: README_CLARITY_GATE_SCHEMA,
          stepType: STEP_TYPES.README_CLARITY_GATE,
          appendSystemPromptFile: ensureSystemPrompt(wsPath, "readme-clarity-gate"),
          onResultText: (text) => { resultText = text; },
          skipAskUserQuestion: true,
        };

        const feasibility = await prepareCriteriaFeasibility(ws);
        const [clarityOk, feasibilityOk] = await ctx.runChildGroup(
          feasibility ? [clarityChild, feasibility.child] : [clarityChild],
        );

        // Fail open: a judge hiccup should not block an otherwise-legitimate run.
        let stop: { reason: string; missing: string[] } | null = null;
        if (!clarityOk || !resultText) {
          ctx.emitStatus("README clarity check did not return a verdict — proceeding");
        } else {
          let parsed: { sufficient?: boolean; reason?: string; missing?: string[] } | null = null;
          try {
            parsed = JSON.parse(resultText);
          } catch {
            ctx.emitStatus("Could not parse README clarity verdict — proceeding");
          }
          const reason = parsed?.reason ?? "";
          if (parsed?.sufficient === false) {
            stop = { reason, missing: Array.isArray(parsed.missing) ? parsed.missing : [] };
          } else if (parsed) {
            ctx.emitResult(`**README is clear enough to proceed.**${reason ? ` ${reason}` : ""}`);
          }
        }

        if (stop) {
          // Too unclear: stop here and recommend refining the README. The
          // feasibility verdict is deliberately discarded — it judged criteria
          // that are about to be rewritten, so recording it would seed the
          // ledger with entries about a contract that no longer exists.
          const missingList =
            stop.missing.length > 0 ? `\n\nMissing / unclear:\n- ${stop.missing.join("\n- ")}` : "";
          ctx.emitResult(
            `${README_CLARITY_STOP_PREFIX}${stop.reason ? ` ${stop.reason}` : ""}${missingList}\n\n` +
              "No code was changed. Refine the workspace README (Goal / Non-Goal / Acceptance Criteria) — e.g. via an **update-readme** operation — then re-run the autonomous flow.",
          );
          return true;
        }

        if (feasibility) {
          await feasibility.apply(ctx, feasibilityOk === true);
        }
        ctx.appendPhases([
          buildCycleExecutePhase(1),
          buildCycleReviewPhase(1),
          buildCycleGatePhase(1),
        ]);
        return true;
      },
    };
  }

  // Helper to build the Create PR phase
  function buildCreatePrPhase(): PipelinePhase {
    return {
      kind: "function",
      label: "Create PR",
      timeoutMs: 15 * 60 * 1000,
      fn: async (ctx) => {
        const ws = resolveWorkspace(ctx.operationId, workspace);
        ctx.emitStatus(`Creating PR for workspace: ${ws}`);
        const prPhases = await buildCreatePrPipeline({
          workspace: ws,
          draft: draft !== false,
          repository: repo,
        });
        return runSubPhases(ctx, prPhases, skip);
      },
    };
  }

  // Start with cycle 1 — subsequent cycles are appended dynamically by gate logic.
  // For resume, pre-generate all cycle phases so the resumeFrom index is valid.
  if (input.resumeCycles) {
    for (const { cycle, hasUpdateTodo } of input.resumeCycles) {
      phases.push(buildCycleExecutePhase(cycle));
      phases.push(buildCycleReviewPhase(cycle));
      phases.push(buildCycleGatePhase(cycle));
      if (hasUpdateTodo) {
        phases.push(buildCycleUpdateTodoPhase(cycle, []));
      }
    }
  } else if (!initClarityGated) {
    // No feasibility judge here: a run starting from execute / update-todo is
    // re-reading a contract that was already judged where it was written (the
    // init path's clarity gate, or an `update-readme` operation). Re-judging it
    // cost a serial worktree-reading phase per run for a verdict already in the
    // ledger — a PR-review turnaround paid ~3 min of it before touching code.
    phases.push(buildCycleExecutePhase(1));
    phases.push(buildCycleReviewPhase(1));
    phases.push(buildCycleGatePhase(1));
  }
  // When initClarityGated, the README clarity gate appends cycle 1 (or stops
  // the run and recommends update-readme) after the README is drafted.

  // For resume: if "Create PR" was dynamically appended before crash, include it
  if (input.resumeWithCreatePr) {
    phases.push(buildCreatePrPhase());
  }

  return phases;
}
