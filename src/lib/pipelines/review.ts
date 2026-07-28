import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta, parseConstraints, parseAcceptanceCriteria } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  prepareReviewDir,
  writeReportTemplates,
} from "@/lib/workspace";
import {
  buildCodeReviewerPrompt,
  buildTodoVerifierPrompt,
  buildReadmeVerifierPrompt,
  buildCollectorPrompt,
  buildCrossRepositoryReviewerPrompt,
} from "@/lib/templates";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { readKnownFindings } from "@/lib/workspace/known-findings";
import { execConstraintCommand, buildConstraintReport } from "@/lib/workspace/constraint-runner";
import type { ConstraintExecResult } from "@/lib/workspace/constraint-runner";
import { getCleanEnv } from "@/lib/env";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";

export async function buildReviewPipeline(input: {
  workspace: string;
  repository?: string;
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
}): Promise<PipelinePhase[]> {
  const { workspace, repository } = input;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = input.repos ?? listWorkspaceRepos(workspace);
  const repos = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;
  const wsPath = path.join(getWorkspaceDir(), workspace);

  // Write report templates (idempotent — ensures templates exist for older workspaces)
  await writeReportTemplates(wsPath);

  const reviewTimestamp = prepareReviewDir(workspace);
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);

  // Parse constraints from README for programmatic verification
  const allConstraints = parseConstraints(readmeContent);

  // Findings earlier cycles decided not to act on. Reviewers are spawned fresh
  // each cycle, so this is their only memory of that decision.
  const knownFindings = await readKnownFindings(wsPath);

  // Pre-render the Acceptance Criteria checklist so the README verifier gets an
  // unambiguous auto/manual split instead of re-parsing prose.
  const acceptanceCriteria = parseAcceptanceCriteria(readmeContent)
    .map((c) => `- [${c.checked ? "x" : " "}] (${c.kind}) ${c.text}`)
    .join("\n");

  // Build review + verify children for phase 1 (parallel)
  const reviewChildren: GroupChild[] = [];
  const repoBaseBranches = new Map<string, string>();
  // Collected per-repo context for the cross-repository reviewer (multi-repo only).
  const crossRepoInputs: {
    repoName: string;
    repoPath: string;
    baseBranch: string;
    worktreePath: string;
    repoChanges: string;
  }[] = [];

  for (const repo of repos) {
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);
    repoBaseBranches.set(repo.repoName, baseBranch);
    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch);
    const repoChangesText = `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`;

    crossRepoInputs.push({
      repoName: repo.repoName,
      repoPath: repo.repoPath,
      baseBranch,
      worktreePath: repo.worktreePath,
      repoChanges: repoChangesText,
    });

    const orgName = repo.repoPath.split("/").slice(0, -1).join("_") || "local";
    const reviewFileName = `REVIEW-${orgName}_${repo.repoName}.md`;
    const verifyFileName = `VERIFY-TODO-${orgName}_${repo.repoName}.md`;

    // Code reviewer
    reviewChildren.push({
      label: `review-${repo.repoName}`,
      stepType: STEP_TYPES.CODE_REVIEW,
      prompt: buildCodeReviewerPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch,
        reviewTimestamp,
        readmeContent,
        worktreePath: repo.worktreePath,
        repoChanges: repoChangesText,
        reviewFilePath: path.join(reviewDir, reviewFileName),
        knownFindings,
      }),
      addDirs: [reviewDir],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "code-reviewer"),
    });

    // TODO verifier — skipped when the repo has no TODO file (or it's empty),
    // since there is nothing for the verifier to check against.
    const todoFileName = `TODO-${repo.repoName}.md`;
    const todoFile = Bun.file(path.join(wsPath, todoFileName));
    const todoContent = (await todoFile.exists())
      ? await todoFile.text()
      : "";

    if (todoContent.trim() !== "") {
      reviewChildren.push({
        label: `verify-todo-${repo.repoName}`,
        stepType: STEP_TYPES.VERIFY_TODO,
        prompt: buildTodoVerifierPrompt({
          workspaceName: workspace,
          repoPath: repo.repoPath,
          repoName: repo.repoName,
          baseBranch,
          reviewTimestamp,
          todoContent,
          worktreePath: repo.worktreePath,
          verifyFilePath: path.join(reviewDir, verifyFileName),
        }),
        addDirs: [reviewDir],
        appendSystemPromptFile: ensureSystemPrompt(wsPath, "todo-verifier"),
      });
    }

    // README verifier
    const readmeVerifyFileName = `VERIFY-README-${orgName}_${repo.repoName}.md`;
    reviewChildren.push({
      label: `verify-readme-${repo.repoName}`,
      stepType: STEP_TYPES.VERIFY_README,
      prompt: buildReadmeVerifierPrompt({
        workspaceName: workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch,
        reviewTimestamp,
        readmeContent,
        acceptanceCriteria,
        worktreePath: repo.worktreePath,
        repoChanges: repoChangesText,
        verifyFilePath: path.join(reviewDir, readmeVerifyFileName),
      }),
      addDirs: [reviewDir],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "readme-verifier"),
    });
  }

  // Cross-repository review: only when the whole workspace (no single-repo
  // filter) has more than one repo. Catches issues that span repos — API/contract
  // mismatches, shared-type drift, coordinated migrations — that per-repo
  // reviewers can't see in isolation. Output filename matches the REVIEW-* glob
  // so the collector and autonomous gate pick it up automatically.
  //
  // `unshift`, not `push`: it has to be built here because it needs every repo's
  // diff from the loop above, but the group starts children in array order
  // behind a FIFO semaphore, and this is the longest-running child of the set
  // (it reads across all worktrees). Appending it would put the critical path
  // last in the queue whenever the fan-out exceeds the concurrency limit.
  if (!repository && repos.length > 1) {
    reviewChildren.unshift({
      label: "review-cross-repository",
      stepType: STEP_TYPES.CODE_REVIEW,
      prompt: buildCrossRepositoryReviewerPrompt({
        workspaceName: workspace,
        reviewTimestamp,
        readmeContent,
        reviewFilePath: path.join(reviewDir, "REVIEW-cross-repository.md"),
        repos: crossRepoInputs,
        knownFindings,
      }),
      addDirs: [reviewDir, ...repos.map((r) => r.worktreePath)],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "cross-repository-reviewer"),
    });
  }

  return [
    // Phase 1: Run code reviews and TODO verifiers in parallel
    {
      kind: "group",
      children: reviewChildren,
    },
    // Phase 2: Run constraint commands programmatically
    {
      kind: "function",
      label: "Verify constraints",
      timeoutMs: 10 * 60 * 1000,
      fn: async (ctx) => {
        if (allConstraints.length === 0) {
          ctx.emitStatus("No constraints found in README — skipping verification");
          return true;
        }

        let anyFailure = false;
        const env = getCleanEnv();

        for (const repo of repos) {
          const repoConstraints = allConstraints.find(
            (c) => c.repoName === repo.repoName,
          );
          if (!repoConstraints || repoConstraints.constraints.length === 0) continue;

          const baseBranch = repoBaseBranches.get(repo.repoName) ?? "main";
          const orgName = repo.repoPath.split("/").slice(0, -1).join("_") || "local";
          const constraintFileName = `CONSTRAINTS-${orgName}_${repo.repoName}.md`;
          const results: ConstraintExecResult[] = [];

          for (const constraint of repoConstraints.constraints) {
            ctx.emitStatus(`[${repo.repoName}] Running: ${constraint.label} (\`${constraint.command}\`)`);
            const result = await execConstraintCommand(constraint.command, {
              cwd: repo.worktreePath,
            });

            // Determine status
            let status: ConstraintExecResult["status"];
            if (result.timedOut) {
              status = "FAIL";
            } else if (result.exitCode === 127 || result.exitCode === 126) {
              status = "SKIPPED";
            } else if (result.exitCode === 0) {
              status = "PASS";
            } else {
              // Check if the failure is pre-existing by running on the merge-base
              status = await checkPreExisting(
                constraint.command,
                repo.worktreePath,
                baseBranch,
                env,
              );
            }

            const passed = status === "PASS";
            if (!passed && status === "FAIL") anyFailure = true;

            results.push({
              label: constraint.label,
              command: constraint.command,
              exitCode: result.exitCode,
              passed,
              stdout: result.stdout,
              stderr: result.stderr,
              timedOut: result.timedOut,
              durationMs: result.durationMs,
              status,
            });

            ctx.emitStatus(
              `[${repo.repoName}] ${constraint.label}: ${status} (exit ${result.exitCode ?? "timeout"}, ${result.durationMs}ms)`,
            );

            // Skip the rest of this repo's constraints: they often depend on the
            // timed-out command's artifacts and stacking 5min timeouts blows the phase budget.
            if (result.timedOut) {
              ctx.emitStatus(
                `[${repo.repoName}] timeout detected — skipping remaining constraints for this repo`,
              );
              break;
            }
          }

          const report = buildConstraintReport(repo.repoName, results);
          await Bun.write(path.join(reviewDir, constraintFileName), report);
        }

        if (anyFailure) {
          ctx.emitResult("Constraint verification completed with failures");
        } else {
          ctx.emitResult("All constraints passed (or skipped/pre-existing)");
        }
        return true;
      },
    },
    // Phase 3: Collect results into summary
    {
      kind: "function",
      label: "Collect review results",
      timeoutMs: getTimeoutDefaults("review").claudeMs,
      fn: async (ctx) => {
        // List actual review/verify files using Bun.Glob
        const reviewGlob = new Bun.Glob("REVIEW-*");
        const verifyGlob = new Bun.Glob("VERIFY-TODO-*");
        const readmeVerifyGlob = new Bun.Glob("VERIFY-README-*");
        const constraintGlob = new Bun.Glob("CONSTRAINTS-*");
        const actualReviewFiles = [...reviewGlob.scanSync({ cwd: reviewDir })];
        const actualReadmeVerifyFiles = new Set([...readmeVerifyGlob.scanSync({ cwd: reviewDir })]);
        const actualVerifyFiles = [...verifyGlob.scanSync({ cwd: reviewDir })];
        const actualConstraintFiles = [...constraintGlob.scanSync({ cwd: reviewDir })];

        const prompt = buildCollectorPrompt({
          workspaceName: workspace,
          reviewTimestamp,
          reviewDir,
          reviewFiles: actualReviewFiles.map((f) => path.join(reviewDir, f)),
          verifyFiles: actualVerifyFiles.map((f) => path.join(reviewDir, f)),
          readmeVerifyFiles: [...actualReadmeVerifyFiles].map((f) => path.join(reviewDir, f)),
          constraintFiles: actualConstraintFiles.map((f) => path.join(reviewDir, f)),
        });

        const ok = await ctx.runChild("Collect reviews", prompt, { addDirs: [reviewDir], stepType: STEP_TYPES.COLLECT_REVIEWS, appendSystemPromptFile: ensureSystemPrompt(wsPath, "collector") });
        return ok;
      },
    },
  ];
}

/**
 * Check whether a constraint failure is pre-existing (also fails on the merge-base)
 * or a regression introduced by the current branch.
 */
async function checkPreExisting(
  command: string,
  worktreePath: string,
  baseBranch: string,
  env: Record<string, string | undefined>,
): Promise<"FAIL" | "PRE-EXISTING"> {
  try {
    // Get the merge-base commit
    const mergeBaseProc = Bun.spawn(
      ["git", "merge-base", "HEAD", `origin/${baseBranch}`],
      { cwd: worktreePath, stdout: "pipe", stderr: "pipe", env },
    );
    const mergeBaseExit = await mergeBaseProc.exited;
    if (mergeBaseExit !== 0) return "FAIL"; // Can't determine merge-base, treat as regression

    const mergeBase = (await new Response(mergeBaseProc.stdout).text()).trim();
    if (!mergeBase) return "FAIL";

    // Check if worktree is clean; stash if needed
    const statusProc = Bun.spawn(
      ["git", "status", "--porcelain"],
      { cwd: worktreePath, stdout: "pipe", stderr: "pipe", env },
    );
    await statusProc.exited;
    const hasChanges = (await new Response(statusProc.stdout).text()).trim() !== "";

    if (hasChanges) {
      const stash = Bun.spawn(["git", "stash", "--include-untracked"], {
        cwd: worktreePath, stdout: "pipe", stderr: "pipe", env,
      });
      await stash.exited;
    }

    // Checkout merge-base
    const checkout = Bun.spawn(["git", "checkout", mergeBase, "--quiet"], {
      cwd: worktreePath, stdout: "pipe", stderr: "pipe", env,
    });
    await checkout.exited;

    // Run the same constraint command on the merge-base
    const baseResult = await execConstraintCommand(command, {
      cwd: worktreePath,
      timeoutMs: 3 * 60 * 1000, // shorter timeout for base check
    });

    // Return to the original branch
    const checkoutBack = Bun.spawn(["git", "checkout", "-"], {
      cwd: worktreePath, stdout: "pipe", stderr: "pipe", env,
    });
    await checkoutBack.exited;

    if (hasChanges) {
      const stashPop = Bun.spawn(["git", "stash", "pop"], {
        cwd: worktreePath, stdout: "pipe", stderr: "pipe", env,
      });
      await stashPop.exited;
    }

    // If the base also fails, it's pre-existing
    if (baseResult.exitCode !== 0 || baseResult.timedOut) {
      return "PRE-EXISTING";
    }

    return "FAIL";
  } catch {
    // If anything goes wrong, treat as regression to be safe
    return "FAIL";
  }
}
