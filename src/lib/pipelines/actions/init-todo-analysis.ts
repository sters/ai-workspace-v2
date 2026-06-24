/**
 * Init's post-setup TODO analysis sub-pipeline (phases C–G):
 * Discover repo constraints → Plan TODOs → Coordinate → Review → Commit snapshot.
 *
 * Used by `buildInitPipeline` for fresh inits and by autonomous's
 * "Ensure TODOs" salvage phase when an existing workspace is missing TODO files.
 */

import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { readWorkspaceReadme } from "@/lib/parsers/readme";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { buildPlannerPrompt } from "@/lib/templates";
import { runBestOfNFiles } from "./best-of-n-files";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase } from "@/types/pipeline";
import type { InteractionLevel } from "@/types/prompts";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";
import { buildCommitSnapshotPhase } from "./commit-snapshot";
import { buildCoordinateTodosPhase } from "./coordinate-todos";
import { buildDiscoverConstraintsPhase } from "./discover-constraints";
import { buildReviewTodosPhase } from "./review-todos";

export interface InitTodoAnalysisRepo {
  repoPath: string;
  repoName: string;
  worktreePath: string;
}

export interface InitTodoAnalysisInput {
  /** Workspace name. Getter so init.ts can pass a closure that reads its mutable state. */
  wsName: () => string;
  /** Workspace absolute path. Getter for the same reason. */
  wsPath: () => string;
  /** Repos to analyze. Getter to support late-binding from init's Phase B. */
  repos: () => InitTodoAnalysisRepo[];
  /** Task type ("feature" | "review" | "research" | …). Skips planning for review/research. */
  taskType: () => string;
  interactionLevel?: InteractionLevel;
  /** Best-of-N count. Only consulted when `getUseBestOfN()` returns true. */
  bestOfN?: number;
  /** Optional runtime override for whether Best-of-N is active. Defaults to bestOfN >= 2. */
  getUseBestOfN?: () => boolean;
  /** Commit message for the final snapshot. */
  commitMessage?: string;
  /** Final result message for the commit phase. */
  commitResultMessage?: string;
  /** Optional free-text instruction to focus/guide TODO planning. Getter for late-binding. */
  instruction?: () => string | undefined;
}

export function buildInitTodoAnalysisPhases(input: InitTodoAnalysisInput): PipelinePhase[] {
  const { wsName, wsPath, repos, taskType, interactionLevel, bestOfN } = input;
  const getUseBestOfN = input.getUseBestOfN ?? (() => bestOfN != null && bestOfN >= 2);

  return [
    // Phase C: Discover repo constraints (lint/test/build) and append to README
    {
      kind: "function",
      label: "Discover repo constraints",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) =>
        buildDiscoverConstraintsPhase({
          workspace: wsName(),
          wsPath: wsPath(),
          repos: repos().map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
        }).fn(ctx),
    },
    // Phase D: Plan TODOs for each repo (parallel, with optional Best-of-N)
    {
      kind: "function",
      label: "Plan TODO items",
      timeoutMs: 60 * 60 * 1000, // 1 hour — may wait for human when Best-of-N
      fn: async (ctx) => {
        const tt = taskType();
        if (tt === "review" || tt === "research") {
          ctx.emitStatus(`${tt === "review" ? "Review" : "Research"} workspace — skipping TODO planning`);
          return true;
        }

        const wp = wsPath();
        const rs = repos();
        const { content: readmeContent, meta } = await readWorkspaceReadme(wp);

        if (rs.length === 0) {
          ctx.emitResult("No repositories configured — skipping TODO planning.");
          return true;
        }

        const plannerAgent = meta.taskType === "research" ? "research-planner" : "planner";
        const buildPlannerChildren = (todoOutputDir?: string, addDirsOverride?: string[]) =>
          rs.map((repo) => ({
            label: `plan-${repo.repoName}`,
            stepType: STEP_TYPES.PLAN_TODO,
            prompt: buildPlannerPrompt({
              workspaceName: wsName(),
              repoPath: repo.repoPath,
              repoName: repo.repoName,
              readmeContent,
              worktreePath: repo.worktreePath,
              taskType: meta.taskType,
              interactive: interactionLevel === "high",
              todoOutputDir,
              instruction: input.instruction?.(),
            }),
            addDirs: addDirsOverride ?? [wp],
            appendSystemPromptFile: ensureSystemPrompt(wp, plannerAgent),
          }));

        const cleanup = () => {
          const templatePath = path.join(wp, "templates", "TODO-template.md");
          if (existsSync(templatePath)) {
            unlinkSync(templatePath);
          }
        };

        if (getUseBestOfN() && bestOfN && bestOfN >= 2) {
          const todoFiles = rs.map((r) => path.join(wp, `TODO-${r.repoName}.md`));
          const templatePath = path.join(wp, "templates", "TODO-template.md");
          const filesToCapture = existsSync(templatePath)
            ? [...todoFiles, templatePath]
            : todoFiles;

          const result = await runBestOfNFiles({
            ctx,
            n: bestOfN,
            operationType: "plan-todo",
            filesToCapture,
            buildChildren: (candidateDir) =>
              buildPlannerChildren(
                candidateDir,
                [candidateDir, ...rs.map((r) => r.worktreePath)],
              ),
            interactionLevel,
          });

          cleanup();
          return result;
        }

        const children = buildPlannerChildren();
        ctx.emitStatus(`Planning TODOs for ${children.length} repositories`);
        const results = await ctx.runChildGroup(children);
        const allSuccess = results.every(Boolean);
        ctx.emitStatus(
          `Planning complete: ${results.filter(Boolean).length}/${results.length} succeeded`,
        );
        cleanup();
        return allSuccess;
      },
    },
    // Phase E: Coordinate TODOs across repos
    {
      kind: "function",
      label: "Coordinate TODOs",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) => {
        const tt = taskType();
        if (tt === "review" || tt === "research") {
          ctx.emitStatus(`${tt === "review" ? "Review" : "Research"} workspace — skipping TODO coordination`);
          return Promise.resolve(true);
        }
        const rs = repos();
        return buildCoordinateTodosPhase({
          workspace: wsName(),
          wsPath: wsPath(),
          repoNames: rs.map((r) => r.repoName),
          repoWorktrees: rs.map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
        }).fn(ctx);
      },
    },
    // Phase F: Review TODOs (parallel, per repo)
    {
      kind: "function",
      label: "Review TODOs",
      timeoutMs: getTimeoutDefaults("init").claudeMs,
      fn: (ctx) => {
        const tt = taskType();
        if (tt === "review" || tt === "research") {
          ctx.emitStatus(`${tt === "review" ? "Review" : "Research"} workspace — skipping TODO review`);
          return Promise.resolve(true);
        }
        return buildReviewTodosPhase({
          workspace: wsName(),
          wsPath: wsPath(),
          repos: repos().map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
        }).fn(ctx);
      },
    },
    // Phase G: Commit workspace snapshot
    {
      kind: "function",
      label: "Commit snapshot",
      fn: (ctx) =>
        buildCommitSnapshotPhase(
          wsName(),
          input.commitMessage ?? "Init complete: workspace setup and TODO planning",
          input.commitResultMessage ?? `Workspace **${wsName()}** initialization complete.`,
        ).fn(ctx),
    },
  ];
}
