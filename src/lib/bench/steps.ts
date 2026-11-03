/**
 * Steps a bench can re-run: each builds its child from the workspace as it is
 * on disk, through the same function the pipeline uses, so a bench measures
 * the prompt the pipeline sends. Only steps whose verdict is structured are
 * here, since agreement is computed from it.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { getReadme, getReviewSessions } from "@/lib/workspace/reader";
import { listWorkspaceRepos, getRepoChanges } from "@/lib/workspace";
import { readPreviousReviewBaseline } from "@/lib/workspace/review-baseline";
import { parseReadmeMeta, renderAcceptanceCriteria, readWorkspaceReadme } from "@/lib/parsers/readme";
import { buildCompletionVerifierChild, formatRepoChanges, resolveRepoBaseBranch } from "@/lib/pipelines/review";
import { buildAutonomousGateChild, buildReadmeClarityChild } from "@/lib/pipelines/autonomous";
import { buildTodoReviewChild } from "@/lib/pipelines/actions/review-todos";
import { prepareCriteriaFeasibility } from "@/lib/pipelines/actions/criteria-feasibility";
import { STEP_TYPES } from "@/types/pipeline";
import type { GroupChild, StepType } from "@/types/pipeline";

export interface BenchStep {
  stepType: StepType;
  label: string;
  /** Runs against one repository of the workspace, which the caller names. */
  perRepo: boolean;
  build: (workspace: string, repoName?: string) => Promise<GroupChild | { error: string }>;
}

async function findRepo(workspace: string, repoName: string | undefined) {
  const repos = await listWorkspaceRepos(workspace);
  return repos.find((r) => r.repoName === repoName) ?? null;
}

const STEPS: BenchStep[] = [
  {
    stepType: STEP_TYPES.VERIFY_COMPLETION,
    label: "Completion verifier",
    perRepo: true,
    build: async (workspace, repoName) => {
      const repo = await findRepo(workspace, repoName);
      if (!repo) return { error: `No repository ${repoName ?? "(none)"} in ${workspace}` };
      const latest = (await getReviewSessions(workspace))[0];
      if (!latest) return { error: "Run a review first: the verifier reads that review's constraint report" };

      const wsPath = path.join(getWorkspaceDir(), workspace);
      const readmeContent = (await getReadme(workspace)) ?? "";
      const baseBranch = await resolveRepoBaseBranch(parseReadmeMeta(readmeContent), repo);
      // The range the latest review was given: everything since the review before it.
      const sinceSha = (await readPreviousReviewBaseline(wsPath, latest.timestamp))?.heads[repo.repoName];
      const changes = await getRepoChanges(workspace, repo.repoPath, baseBranch, sinceSha);
      const { child } = await buildCompletionVerifierChild({
        workspace,
        wsPath,
        repo,
        baseBranch,
        readmeContent,
        acceptanceCriteria: renderAcceptanceCriteria(readmeContent),
        repoChanges: formatRepoChanges(changes),
        reviewDir: path.join(wsPath, "artifacts", "reviews", latest.timestamp),
      });
      return child;
    },
  },
  {
    stepType: STEP_TYPES.REVIEW_TODOS,
    label: "TODO plan reviewer",
    perRepo: true,
    build: async (workspace, repoName) => {
      const repo = await findRepo(workspace, repoName);
      if (!repo) return { error: `No repository ${repoName ?? "(none)"} in ${workspace}` };
      const wsPath = path.join(getWorkspaceDir(), workspace);
      const todoFile = Bun.file(path.join(wsPath, `TODO-${repo.repoName}.md`));
      if (!(await todoFile.exists())) return { error: `${repo.repoName} has no TODO file` };
      const { content: readmeContent } = await readWorkspaceReadme(wsPath);
      return buildTodoReviewChild({ workspace, wsPath, repo, readmeContent, todoContent: await todoFile.text() });
    },
  },
  {
    stepType: STEP_TYPES.README_CLARITY_GATE,
    label: "README clarity gate",
    perRepo: false,
    build: (workspace) => buildReadmeClarityChild(workspace),
  },
  {
    stepType: STEP_TYPES.CRITERIA_FEASIBILITY,
    label: "Criteria feasibility",
    perRepo: false,
    build: async (workspace) => {
      // Only the child: the verdict is not applied to the known-findings ledger.
      const prepared = await prepareCriteriaFeasibility(workspace);
      return prepared ? prepared.child : { error: "The README has no (auto) acceptance criteria to judge" };
    },
  },
  {
    stepType: STEP_TYPES.AUTONOMOUS_GATE,
    label: "Autonomous gate",
    perRepo: false,
    build: async (workspace) => {
      // Judged as the first of three cycles, with no earlier gate to continue from.
      const built = await buildAutonomousGateChild(workspace, { loopIteration: 1, maxLoops: 3 });
      return "settledReason" in built ? { error: built.settledReason } : built.child;
    },
  },
];

export const BENCH_STEPS: ReadonlyMap<string, BenchStep> = new Map(STEPS.map((s) => [s.stepType, s]));
