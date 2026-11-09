import path from "node:path";
import { readVerificationResults } from "@/lib/verification/store";
import { getWorkspaceDir } from "@/lib/config";
import { getReadme } from "@/lib/workspace/reader";
import { parseReadmeMeta, parseConstraints, renderAcceptanceCriteria } from "@/lib/parsers/readme";
import {
  listWorkspaceRepos,
  detectBaseBranch,
  getRepoChanges,
  prepareReviewDir,
  writeReportTemplates,
} from "@/lib/workspace";
import {
  buildCodeReviewerPrompt,
  buildCompletionVerifierPrompt,
  COMPLETION_VERIFICATION_SCHEMA,
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
import { readRepoGuidance } from "@/lib/workspace/repo-guidance";
import { findingsFilePath } from "@/lib/workspace/review-findings";
import {
  buildReviewSummary,
  parseFixVerificationTable,
  parseReportItems,
  renderReadmeVerification,
  renderTodoVerification,
} from "@/lib/workspace/review-summary";
import type { RepoSummaryInput } from "@/lib/workspace/review-summary";
import { completionVerificationSchema } from "@/lib/runtime-schemas";
import type { CompletionVerification } from "@/types/review-verification";
import { repoReportStem } from "@/lib/workspace/review-report-names";
import { selectRepos } from "@/lib/workspace/select-repos";
import { collectPostedAsks } from "@/lib/workspace/posted-findings";
import { buildRefreshWorktreesPhase } from "./actions/refresh-worktrees";
import { runSubPhases } from "./actions/run-sub-phases";
import {
  execConstraintCommand,
  buildConstraintReport,
  buildNoConstraintsReport,
} from "@/lib/workspace/constraint-runner";
import type { ConstraintExecResult } from "@/lib/workspace/constraint-runner";
import {
  expandConstraintCommand,
  resolveConstraintScope,
  usesScope,
} from "@/lib/workspace/constraint-scope";
import { getCleanEnv } from "@/lib/env";
import { STEP_TYPES } from "@/types/pipeline";
import type { PipelinePhase, GroupChild } from "@/types/pipeline";
import type { CrossRepositoryReviewerInput } from "@/types/prompts";
import { startOperationPipeline } from "@/lib/pipeline-manager";

export interface ReviewPipelineInput {
  workspace: string;
  repository?: string;
  /**
   * Reviews only these worktrees on their own — an autonomous cycle's
   * unfinished set. The cross-repository reviewer still reads every worktree
   * `repository` selects, since a finished repository remains the other side of
   * each boundary an unfinished one can move.
   */
  repositories?: readonly string[];
  /**
   * Fixes the previous autonomous cycle's gate asked for. When present, a
   * verifier child checks each one against the code — the gate otherwise infers
   * this from TODO checkboxes, which record intent rather than outcome.
   */
  requestedFixes?: string[];
  /**
   * Fast-forward each worktree onto the branch it tracks first, so the review
   * reads the pull request as it now stands rather than as it was checked out.
   * This is what makes a re-review of an updated PR possible at all; see
   * `actions/refresh-worktrees.ts`.
   */
  refreshFromRemote?: boolean;
  /**
   * Verify the findings this workspace already posted on its PRs, alongside the
   * review. Off for an autonomous cycle, whose asks come from its own gate; on
   * for a review a human started, where the outstanding asks are the comments
   * on the PR.
   */
  carryPostedFindings?: boolean;
}

type ChangeSummary = Awaited<ReturnType<typeof getRepoChanges>>;

/** The branch, changed files, diff stat and commit log, as reviewers are given them. */
export function formatRepoChanges(changes: ChangeSummary): string {
  return `Branch: ${changes.currentBranch}\n\nChanged files:\n${changes.changedFiles}\n\nDiff stat:\n${changes.diffStat}\n\nCommit log:\n${changes.commitLog}`;
}

/** The README's base branch for the repository, or the one its worktree tracks. */
export async function resolveRepoBaseBranch(
  meta: ReturnType<typeof parseReadmeMeta>,
  repo: { repoPath: string; repoName: string; worktreePath: string },
): Promise<string> {
  const metaRepo = meta.repositories.find((r) => r.path === repo.repoPath || r.alias === repo.repoName);
  return metaRepo?.baseBranch ?? (await detectBaseBranch(repo.worktreePath));
}

/** A completion verifier's verdict, or undefined when the text is not one. */
export function parseCompletionVerification(text: string): CompletionVerification | undefined {
  try {
    const parsed = completionVerificationSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The completion verifier child for one repository. It reads the constraint
 * report the review's `Verify constraints` phase writes into `reviewDir`, so a
 * criterion phrased as "the declared commands exit 0" is answered from it
 * instead of by re-running the build and test suite.
 */
export async function buildCompletionVerifierChild(input: {
  workspace: string;
  wsPath: string;
  repo: { repoPath: string; repoName: string; worktreePath: string };
  baseBranch: string;
  readmeContent: string;
  acceptanceCriteria: string;
  repoChanges: string;
  reviewDir: string;
}): Promise<{ child: GroupChild; hasTodo: boolean }> {
  const { repo } = input;
  const todoFile = Bun.file(path.join(input.wsPath, `TODO-${repo.repoName}.md`));
  const todoContent = (await todoFile.exists()) ? (await todoFile.text()).trim() : "";
  const stem = repoReportStem(repo.repoPath, repo.repoName);
  return {
    hasTodo: todoContent !== "",
    child: {
      label: `verify-${repo.repoName}`,
      stepType: STEP_TYPES.VERIFY_COMPLETION,
      prompt: buildCompletionVerifierPrompt({
        workspaceName: input.workspace,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        baseBranch: input.baseBranch,
        readmeContent: input.readmeContent,
        acceptanceCriteria: input.acceptanceCriteria,
        todoContent,
        worktreePath: repo.worktreePath,
        repoChanges: input.repoChanges,
        constraintReportPath: path.join(input.reviewDir, `CONSTRAINTS-${stem}.md`),
        verificationResults: await readVerificationResults(input.wsPath),
      }),
      jsonSchema: COMPLETION_VERIFICATION_SCHEMA as unknown as Record<string, unknown>,
      addDirs: [input.reviewDir],
      appendSystemPromptFile: await ensureSystemPrompt(input.wsPath, "completion-verifier"),
    },
  };
}

/**
 * Budget for a review run as a sub-pipeline of one function phase.
 *
 * `runSubPhases` discards the inner phases' own `timeoutMs`, so this is the only
 * budget that applies once the review is built inside a phase. Sized like the
 * autonomous cycle's review phase: the reviewer group scales with repo count,
 * plus 10 min of constraints.
 */
const REVIEW_SUBPIPELINE_BUDGET_MS = 45 * 60 * 1000;

/**
 * A review built at run time and executed as a sub-pipeline.
 *
 * Needed because everything below — each repo's HEAD, its diff, the review
 * scope, the baseline — is resolved while the pipeline is *built*. A phase that
 * moves HEAD therefore has to run before the build, not before the first review
 * child, so the build is deferred into a phase of its own.
 */
export function buildDeferredReviewPhase(input: ReviewPipelineInput): PipelinePhase {
  return {
    kind: "function",
    label: "Review",
    timeoutMs: REVIEW_SUBPIPELINE_BUDGET_MS,
    fn: async (ctx) => {
      const phases = await buildReviewPipeline(input);
      return runSubPhases(ctx, phases);
    },
  };
}

export async function buildReviewPipeline(
  input: ReviewPipelineInput,
): Promise<PipelinePhase[]> {
  const { workspace, repository, requestedFixes } = input;

  if (input.refreshFromRemote) {
    return [
      buildRefreshWorktreesPhase({ workspace, repository }),
      buildDeferredReviewPhase({ ...input, refreshFromRemote: false }),
    ];
  }

  const hasRequestedFixes = requestedFixes !== undefined && requestedFixes.length > 0;
  const readmeContent = (await getReadme(workspace)) ?? "";
  const meta = parseReadmeMeta(readmeContent);
  const allRepos = await listWorkspaceRepos(workspace);
  const boundaryRepos = selectRepos(allRepos, { repository });
  const repos = selectRepos(boundaryRepos, { repositories: input.repositories });
  const reviewedNames = new Set(repos.map((r) => r.repoName));
  const wsPath = path.join(getWorkspaceDir(), workspace);

  // Idempotent: also covers workspaces created before these templates existed.
  await writeReportTemplates(wsPath);

  const reviewTimestamp = await prepareReviewDir(workspace);
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);

  const allConstraints = parseConstraints(readmeContent);

  // Findings earlier cycles decided not to act on. Reviewers are spawned fresh
  // each cycle, so this is their only memory of that decision.
  const knownFindings = await readKnownFindings(wsPath);

  // Comments this workspace already posted on its PRs, per repository. Used
  // only when the caller has no asks of its own: a cycle's gate asks are the
  // ones that cycle stands behind, and the gate is the only thing that can
  // retire them.
  const postedAsks = input.carryPostedFindings && !hasRequestedFixes
    ? await collectPostedAsks(workspace)
    : new Map<string, string[]>();

  // Pre-render the Acceptance Criteria checklist so the completion verifier gets an
  // unambiguous auto/manual split instead of re-parsing prose.
  const acceptanceCriteria = renderAcceptanceCriteria(readmeContent);

  const reviewChildren: GroupChild[] = [];
  const repoBaseBranches = new Map<string, string>();
  // Filled while the phases run, and read by the summary phase at the end.
  const verifications = new Map<string, { data: CompletionVerification; hasTodo: boolean }>();
  const constraintOutcomes = new Map<string, RepoSummaryInput["constraints"]>();
  // Collected per-repo context for the cross-repository reviewer (multi-repo only).
  const crossRepoInputs: CrossRepositoryReviewerInput["repos"] = [];

  // What each repo's HEAD was at the previous review, so this one can scope
  // itself to the branch's own work since then instead of re-reviewing every
  // commit with a reviewer that has no memory of the earlier sessions.
  const previousBaseline = await readPreviousReviewBaseline(wsPath, reviewTimestamp);
  const currentHeads: Record<string, string> = {};

  for (const repo of boundaryRepos) {
    const baseBranch = await resolveRepoBaseBranch(meta, repo);
    repoBaseBranches.set(repo.repoName, baseBranch);

    const head = await captureRepoHead(repo.worktreePath);
    if (head) currentHeads[repo.repoName] = head;

    const sinceSha = previousBaseline?.heads[repo.repoName];
    const changes = await getRepoChanges(workspace, repo.repoPath, baseBranch, sinceSha);
    const repoChangesText = formatRepoChanges(changes);
    const reviewScope =
      changes.incremental && previousBaseline
        ? { ...changes.incremental, sinceTimestamp: previousBaseline.timestamp }
        : undefined;
    const repoGuidance = (await readRepoGuidance(wsPath, repo.repoName))?.review;

    // Same range the code reviewer gets. The cross-repo reviewer applies a
    // different rule to it (a boundary is in scope when *either* side moved, and
    // it still reads both sides in full); without the range it would re-derive
    // the whole contract surface every cycle from repos that had not moved.
    crossRepoInputs.push({
      repoName: repo.repoName,
      repoPath: repo.repoPath,
      baseBranch,
      worktreePath: repo.worktreePath,
      repoChanges: repoChangesText,
      reviewScope,
      repoGuidance,
    });

    // A repository an autonomous cycle finished stops here. Its head is in the
    // baseline and its side of each boundary is in `crossRepoInputs`, so the next
    // review still scopes it as unchanged, but nothing reviews it on its own.
    if (!reviewedNames.has(repo.repoName)) continue;

    const stem = repoReportStem(repo.repoPath, repo.repoName);
    const reviewFileName = `REVIEW-${stem}.md`;

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
        repoGuidance,
      }),
      addDirs: [reviewDir],
      appendSystemPromptFile: await ensureSystemPrompt(wsPath, "code-reviewer"),
    });

    // Requested-fix verifier — only when something was actually asked for,
    // either by a previous cycle's gate (all repos get the same list, since a
    // gate ask can name any of them) or by a human posting findings on this
    // repository's PR. Separate from the code reviewer so the "did the ask
    // land" verdict and the "is this code good" verdict stay in different files
    // with different scopes.
    const repoFixes = hasRequestedFixes
      ? requestedFixes
      : postedAsks.get(repo.repoName) ?? [];

    if (repoFixes.length > 0) {
      const fixVerifyFileName = `VERIFY-FIXES-${stem}.md`;
      reviewChildren.push({
        label: `verify-fixes-${repo.repoName}`,
        stepType: STEP_TYPES.VERIFY_FIXES,
        prompt: buildFixVerifierPrompt({
          workspaceName: workspace,
          repoPath: repo.repoPath,
          repoName: repo.repoName,
          baseBranch,
          reviewTimestamp,
          requestedFixes: repoFixes,
          askSource: hasRequestedFixes ? "gate" : "pr-comments",
          worktreePath: repo.worktreePath,
          verifyFilePath: path.join(reviewDir, fixVerifyFileName),
          sinceSha: reviewScope?.sinceSha,
          sinceTimestamp: reviewScope?.sinceTimestamp,
        }),
        addDirs: [reviewDir],
        appendSystemPromptFile: await ensureSystemPrompt(wsPath, "fix-verifier"),
      });
    }

    // README requirements and TODO items in one agent: both halves read the same
    // diff and files to answer "was the planned work done". It returns data, and
    // the summary phase renders both reports from it.
    const verifier = await buildCompletionVerifierChild({
      workspace, wsPath, repo, baseBranch, readmeContent, acceptanceCriteria, repoChanges: repoChangesText, reviewDir,
    });
    reviewChildren.push({
      ...verifier.child,
      onResultText: (text) => {
        const data = parseCompletionVerification(text);
        if (data) verifications.set(repo.repoName, { data, hasTodo: verifier.hasTodo });
      },
    });
  }

  // Record where this review started so the next one can scope itself. Written
  // before any child runs: the heads captured above are the point this review
  // judged, and a child that commits during the review must not move it.
  await writeReviewBaseline(wsPath, reviewTimestamp, currentHeads);

  // Cross-repository review: only when the whole workspace (no single-repo
  // filter) has more than one repo. Catches issues that span repos — API/contract
  // mismatches, shared-type drift, coordinated migrations — that per-repo
  // reviewers can't see in isolation. Its report sits beside the per-repo ones,
  // where the summary phase and the autonomous gate read it.
  //
  // `unshift`, not `push`: it has to be built here because it needs every repo's
  // diff from the loop above, but the group starts children in array order
  // behind a FIFO semaphore, and this is the longest-running child of the set
  // (it reads across all worktrees). Appending it would put the critical path
  // last in the queue whenever the fan-out exceeds the concurrency limit.
  if (!repository && boundaryRepos.length > 1) {
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
      addDirs: [reviewDir, ...boundaryRepos.map((r) => r.worktreePath)],
      appendSystemPromptFile: await ensureSystemPrompt(wsPath, "cross-repository-reviewer"),
    });
  }

  return [
    // Constraint commands run programmatically. This is the only place
    // lint/test/build actually run during a review — the code reviewer is told
    // to leave them alone, because only here does a failure get compared against
    // the merge-base before it can reach the gate as a blocker.
    //
    // It runs *before* the reviewer group, not after, so the report is on disk
    // while the completion verifier works: an acceptance criterion phrased as "the
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
          const constraintFileName = `CONSTRAINTS-${repoReportStem(repo.repoPath, repo.repoName)}.md`;

          // Still write a report: an absent file is indistinguishable from a
          // clean run downstream, and no other phase runs these commands.
          if (!repoConstraints || repoConstraints.constraints.length === 0) {
            anyUndeclared = true;
            ctx.emitStatus(
              `[${repo.repoName}] No constraints declared in README — nothing to run`,
            );
            constraintOutcomes.set(repo.repoName, { file: constraintFileName, undeclared: true });
            await Bun.write(
              path.join(reviewDir, constraintFileName),
              buildNoConstraintsReport(repo.repoName),
            );
            continue;
          }

          const results: ConstraintExecResult[] = [];
          const scope = repoConstraints.constraints.some((c) => usesScope(c.command))
            ? await resolveConstraintScope(repo.worktreePath, baseBranch)
            : null;

          for (const constraint of repoConstraints.constraints) {
            const head = expandConstraintCommand(constraint, scope, "head");
            if (head.kind === "skip") {
              results.push({
                label: constraint.label,
                command: constraint.command,
                exitCode: null,
                passed: false,
                stdout: "",
                stderr: head.reason,
                timedOut: false,
                durationMs: 0,
                status: "SKIPPED",
              });
              ctx.emitStatus(`[${repo.repoName}] ${constraint.label}: SKIPPED (${head.reason})`);
              continue;
            }

            ctx.emitStatus(`[${repo.repoName}] Running: ${constraint.label} (\`${constraint.command}\`)`);
            const result = await execConstraintCommand(head.command, {
              cwd: repo.worktreePath,
            });

            let status: ConstraintExecResult["status"];
            if (result.timedOut) {
              status = "FAIL";
            } else if (result.exitCode === 127 || result.exitCode === 126) {
              status = "SKIPPED";
            } else if (result.exitCode === 0) {
              status = "PASS";
            } else {
              // A scoped command whose files all are new to the branch has
              // nothing to run on the merge-base: the failure is the branch's.
              const base = expandConstraintCommand(constraint, scope, "base");
              status = base.kind === "skip"
                ? "FAIL"
                : await checkPreExisting(base.command, repo.worktreePath, baseBranch, env);
            }

            const passed = status === "PASS";
            if (!passed && status === "FAIL") anyFailure = true;

            results.push({
              label: constraint.label,
              command: constraint.command,
              ...(head.command !== constraint.command ? { ran: head.command } : {}),
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

          constraintOutcomes.set(repo.repoName, { file: constraintFileName, results });
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
    {
      kind: "group",
      children: reviewChildren,
    },
    {
      kind: "function",
      label: "Collect review results",
      timeoutMs: 60 * 1000,
      fn: async (ctx) => {
        const readIfExists = async (name: string) => {
          const file = Bun.file(path.join(reviewDir, name));
          return (await file.exists()) ? file.text() : null;
        };

        const repoInputs: RepoSummaryInput[] = [];
        for (const repo of repos) {
          const stem = repoReportStem(repo.repoPath, repo.repoName);
          const reviewFile = `REVIEW-${stem}.md`;
          const reviewText = await readIfExists(reviewFile);

          const verified = verifications.get(repo.repoName);
          let verification: RepoSummaryInput["verification"] = null;
          if (verified) {
            const readmeFile = `VERIFY-README-${stem}.md`;
            const todoFile = verified.hasTodo ? `VERIFY-TODO-${stem}.md` : null;
            await Bun.write(path.join(reviewDir, readmeFile), renderReadmeVerification(repo.repoName, verified.data));
            if (todoFile) await Bun.write(path.join(reviewDir, todoFile), renderTodoVerification(repo.repoName, verified.data));
            verification = { readmeFile, todoFile, data: verified.data };
          }

          const fixesFile = `VERIFY-FIXES-${stem}.md`;
          const fixesText = await readIfExists(fixesFile);

          repoInputs.push({
            repoName: repo.repoName,
            reviewFile,
            review: reviewText === null ? null : parseReportItems(reviewText),
            verification,
            constraints: constraintOutcomes.get(repo.repoName) ?? null,
            fixes: fixesText === null ? null : { file: fixesFile, rows: parseFixVerificationTable(fixesText) },
          });
        }

        const crossFile = "REVIEW-cross-repository.md";
        const crossText = await readIfExists(crossFile);
        const summary = buildReviewSummary({
          reviewTimestamp,
          repos: repoInputs,
          crossRepository: crossText === null ? null : { file: crossFile, items: parseReportItems(crossText) },
        });
        await Bun.write(path.join(reviewDir, "SUMMARY.md"), summary);

        const missing = repoInputs.filter((r) => !r.verification).map((r) => r.repoName);
        ctx.emitResult(
          missing.length > 0
            ? `Review summary written; no completion verdict for ${missing.join(", ")}`
            : "Review summary written",
        );
        return true;
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
    const mergeBaseProc = Bun.spawn(
      ["git", "merge-base", "HEAD", `origin/${baseBranch}`],
      { cwd: worktreePath, stdout: "pipe", stderr: "pipe", env },
    );
    const mergeBaseExit = await mergeBaseProc.exited;
    if (mergeBaseExit !== 0) return "FAIL"; // Can't determine merge-base, treat as regression

    const mergeBase = (await new Response(mergeBaseProc.stdout).text()).trim();
    if (!mergeBase) return "FAIL";

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

    const checkout = Bun.spawn(["git", "checkout", mergeBase, "--quiet"], {
      cwd: worktreePath, stdout: "pipe", stderr: "pipe", env,
    });
    await checkout.exited;

    const baseResult = await execConstraintCommand(command, {
      cwd: worktreePath,
      timeoutMs: 3 * 60 * 1000, // shorter timeout for base check
    });

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

    if (baseResult.exitCode !== 0 || baseResult.timedOut) {
      return "PRE-EXISTING";
    }

    return "FAIL";
  } catch {
    // If anything goes wrong, treat as regression to be safe
    return "FAIL";
  }
}

/**
 * Start a review a human asked for. It verifies the comments already on the
 * PR alongside the code; an autonomous cycle's review does not, since its asks
 * come from its own gate. Throws `ConcurrencyLimitError` when no slot is free.
 */
export async function startUserReview(
  workspace: string,
  options: { repository?: string; refreshFromRemote?: boolean } = {},
) {
  const phases = await buildReviewPipeline({
    workspace,
    repository: options.repository,
    carryPostedFindings: true,
    refreshFromRemote: options.refreshFromRemote,
  });
  return startOperationPipeline("review", workspace, phases, undefined, {
    ...(options.refreshFromRemote && { refreshFromRemote: "true" }),
    ...(options.repository && { repo: options.repository }),
  });
}
