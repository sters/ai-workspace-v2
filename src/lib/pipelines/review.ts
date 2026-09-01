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
  buildFixVerifierPrompt,
} from "@/lib/templates";
import {
  captureRepoHead,
  readPreviousReviewBaseline,
  writeReviewBaseline,
} from "@/lib/workspace/review-baseline";
import { ensureSystemPrompt } from "@/lib/workspace/prompts";
import { readKnownFindings } from "@/lib/workspace/known-findings";
import { findingsFilePath } from "@/lib/workspace/review-findings";
import {
  execConstraintCommand,
  buildConstraintReport,
  buildNoConstraintsReport,
} from "@/lib/workspace/constraint-runner";
import type { ConstraintExecResult } from "@/lib/workspace/constraint-runner";
import { getCleanEnv } from "@/lib/env";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import type { CrossRepositoryReviewerInput } from "@/types/prompts";
import type { WorkspaceRepo } from "@/types/workspace";
import { getTimeoutDefaults } from "@/lib/pipeline-manager";

export async function buildReviewPipeline(input: {
  workspace: string;
  repository?: string;
  /** Pre-resolved repos (e.g. from Best-of-N sub-worktrees). Skips listWorkspaceRepos when provided. */
  repos?: WorkspaceRepo[];
  /**
   * Fixes the previous autonomous cycle's gate asked for. When present, a
   * verifier child checks each one against the code — the gate otherwise infers
   * this from TODO checkboxes, which record intent rather than outcome.
   */
  requestedFixes?: string[];
}): Promise<PipelinePhase[]> {
  const { workspace, repository, requestedFixes } = input;
  const hasRequestedFixes = requestedFixes !== undefined && requestedFixes.length > 0;
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
  const crossRepoInputs: CrossRepositoryReviewerInput["repos"] = [];

  // What each repo's HEAD was at the previous review, so this one can scope
  // itself to the branch's own work since then instead of re-reviewing every
  // commit with a reviewer that has no memory of the earlier sessions.
  const previousBaseline = await readPreviousReviewBaseline(wsPath, reviewTimestamp);
  const currentHeads: Record<string, string> = {};

  for (const repo of repos) {
    const metaRepo = meta.repositories.find(
      (r) => r.path === repo.repoPath || r.alias === repo.repoName,
    );
    const baseBranch = metaRepo?.baseBranch ?? detectBaseBranch(repo.worktreePath);
    repoBaseBranches.set(repo.repoName, baseBranch);

    const head = captureRepoHead(repo.worktreePath);
    if (head) currentHeads[repo.repoName] = head;

    const sinceSha = previousBaseline?.heads[repo.repoName];
    const changes = getRepoChanges(workspace, repo.repoPath, baseBranch, sinceSha);
    const repoChangesText = `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`;
    const reviewScope =
      changes.incremental && previousBaseline
        ? { ...changes.incremental, sinceTimestamp: previousBaseline.timestamp }
        : undefined;

    // Same range the code reviewer gets. The cross-repo reviewer applies a
    // different rule to it (a boundary is in scope when *either* side moved, and
    // it still reads both sides in full), but it is no longer exempt: it was
    // re-deriving the whole contract surface every cycle from repos that had not
    // moved, which is the diff-widening the baseline exists to stop.
    crossRepoInputs.push({
      repoName: repo.repoName,
      repoPath: repo.repoPath,
      baseBranch,
      worktreePath: repo.worktreePath,
      repoChanges: repoChangesText,
      reviewScope,
    });

    const orgName = repo.repoPath.split("/").slice(0, -1).join("_") || "local";
    const reviewFileName = `REVIEW-${orgName}_${repo.repoName}.md`;
    const verifyFileName = `VERIFY-TODO-${orgName}_${repo.repoName}.md`;
    const constraintFileName = `CONSTRAINTS-${orgName}_${repo.repoName}.md`;

    // Code reviewer. Runs on every review, including a round that only applies
    // the previous gate's asks: the fix diff is changed code and gets the same
    // defect hunt as any other. What narrows a fix round is the incremental
    // baseline below, not a reduced child set.
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
        // Second deliverable: the same findings as data, so the review tab can
        // offer them individually for posting on the PR as inline comments.
        findingsFilePath: findingsFilePath(reviewDir, repo.repoPath, repo.repoName),
        knownFindings,
        reviewScope,
      }),
      addDirs: [reviewDir],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "code-reviewer"),
    });

    // Requested-fix verifier — only when a previous cycle actually asked for
    // something. Separate from the code reviewer so the "did the ask land"
    // verdict and the "is this code good" verdict stay in different files with
    // different scopes.
    if (hasRequestedFixes) {
      const fixVerifyFileName = `VERIFY-FIXES-${orgName}_${repo.repoName}.md`;
      reviewChildren.push({
        label: `verify-fixes-${repo.repoName}`,
        stepType: STEP_TYPES.VERIFY_FIXES,
        prompt: buildFixVerifierPrompt({
          workspaceName: workspace,
          repoPath: repo.repoPath,
          repoName: repo.repoName,
          baseBranch,
          reviewTimestamp,
          requestedFixes,
          worktreePath: repo.worktreePath,
          verifyFilePath: path.join(reviewDir, fixVerifyFileName),
          sinceSha: reviewScope?.sinceSha,
          sinceTimestamp: reviewScope?.sinceTimestamp,
        }),
        addDirs: [reviewDir],
        appendSystemPromptFile: ensureSystemPrompt(wsPath, "fix-verifier"),
      });
    }

    // TODO verifier — skipped only when the repo has no TODO file (or it's
    // empty), since there is nothing for the verifier to check against.
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
        // Already written by the Verify constraints phase ahead of this group,
        // so a criterion phrased as "the declared commands exit 0" is answered
        // by reading it instead of re-running the build and test suite.
        constraintReportPath: path.join(reviewDir, constraintFileName),
      }),
      addDirs: [reviewDir],
      appendSystemPromptFile: ensureSystemPrompt(wsPath, "readme-verifier"),
    });
  }

  // Record where this review started so the next one can scope itself. Written
  // before any child runs: the heads captured above are the point this review
  // judged, and a child that commits during the review must not move it.
  await writeReviewBaseline(wsPath, reviewTimestamp, currentHeads);

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
    // Phase 1: Run constraint commands programmatically. This is the only place
    // lint/test/build actually run during a review — the code reviewer is told
    // to leave them alone, because only here does a failure get compared against
    // the merge-base before it can reach the gate as a blocker.
    //
    // It runs *before* the reviewer group, not after, so the report is on disk
    // while the README verifier works: an acceptance criterion phrased as "the
    // declared commands exit 0" was otherwise verified by re-running the whole
    // build and test suite, once per cycle, duplicating this phase's work with
    // no merge-base comparison behind it. Costs nothing in wall clock — the
    // phase is deterministic and the same length wherever it sits.
    {
      kind: "function",
      label: "Verify constraints",
      timeoutMs: 10 * 60 * 1000,
      fn: async (ctx) => {
        let anyFailure = false;
        let anyUndeclared = false;
        const env = getCleanEnv();

        for (const repo of repos) {
          const repoConstraints = allConstraints.find(
            (c) => c.repoName === repo.repoName,
          );
          const baseBranch = repoBaseBranches.get(repo.repoName) ?? "main";
          const orgName = repo.repoPath.split("/").slice(0, -1).join("_") || "local";
          const constraintFileName = `CONSTRAINTS-${orgName}_${repo.repoName}.md`;

          // Still write a report: an absent file is indistinguishable from a
          // clean run downstream, and no other phase runs these commands now.
          if (!repoConstraints || repoConstraints.constraints.length === 0) {
            anyUndeclared = true;
            ctx.emitStatus(
              `[${repo.repoName}] No constraints declared in README — nothing to run`,
            );
            await Bun.write(
              path.join(reviewDir, constraintFileName),
              buildNoConstraintsReport(repo.repoName),
            );
            continue;
          }

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
        } else if (anyUndeclared && allConstraints.length === 0) {
          ctx.emitResult(
            "No constraints declared in the README — nothing was verified mechanically",
          );
        } else if (anyUndeclared) {
          ctx.emitResult(
            "All declared constraints passed (or skipped/pre-existing); some repos declare none",
          );
        } else {
          ctx.emitResult("All constraints passed (or skipped/pre-existing)");
        }
        return true;
      },
    },
    // Phase 2: Run the review + verify children in parallel
    {
      kind: "group",
      children: reviewChildren,
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
        const fixVerifyGlob = new Bun.Glob("VERIFY-FIXES-*");
        const actualReviewFiles = [...reviewGlob.scanSync({ cwd: reviewDir })];
        const actualReadmeVerifyFiles = new Set([...readmeVerifyGlob.scanSync({ cwd: reviewDir })]);
        const actualVerifyFiles = [...verifyGlob.scanSync({ cwd: reviewDir })];
        const actualConstraintFiles = [...constraintGlob.scanSync({ cwd: reviewDir })];
        const actualFixVerifyFiles = [...fixVerifyGlob.scanSync({ cwd: reviewDir })];

        const prompt = buildCollectorPrompt({
          workspaceName: workspace,
          reviewTimestamp,
          reviewDir,
          reviewFiles: actualReviewFiles.map((f) => path.join(reviewDir, f)),
          verifyFiles: actualVerifyFiles.map((f) => path.join(reviewDir, f)),
          readmeVerifyFiles: [...actualReadmeVerifyFiles].map((f) => path.join(reviewDir, f)),
          constraintFiles: actualConstraintFiles.map((f) => path.join(reviewDir, f)),
          fixVerifyFiles: actualFixVerifyFiles.map((f) => path.join(reviewDir, f)),
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
