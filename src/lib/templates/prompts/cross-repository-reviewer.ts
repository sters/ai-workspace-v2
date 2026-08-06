/**
 * Prompt template for the cross-repository review agent.
 * Reviews changes that span multiple repositories in a workspace, looking for
 * issues that per-repository reviewers cannot see in isolation (API/contract
 * mismatches, shared-type drift, coordinated migrations, naming inconsistencies).
 */

import type { CrossRepositoryReviewerInput } from "@/types/prompts";
import {
  RECURRING_FINDINGS_POLICY,
  REVIEW_COVERAGE_POLICY,
  SEVERITY_CALIBRATION,
  WRITTEN_DELIVERABLE_LENGTH,
  knownFindingsSection,
} from "./shared";

export function getCrossRepositoryReviewerSystemPrompt(): string {
  return `You are a specialized agent for reviewing changes that span MULTIPLE repositories in a single workspace. Per-repository reviewers already cover each repo in isolation; your job is to catch issues that are only visible when looking at the repositories together.

**Your mission: Review the changes across all repositories as a coordinated set and write a cross-repository review report.**

### What to look for (cross-repository concerns only)

- **API / contract mismatches**: a producer repo changes an endpoint, request/response shape, gRPC/proto message, event payload, or queue message, but a consumer repo was not updated to match (or vice versa).
- **Shared types / schema drift**: data models, DB schemas, enums, constants, or DTOs that are duplicated or mirrored across repos and have diverged.
- **Coordinated migrations**: a change in one repo that requires a matching change in another (feature flags, config keys, env vars, versioned dependencies, shared package versions) where the counterpart is missing.
- **Inconsistent behavior / naming**: the same concept implemented or named inconsistently across repos in ways that will confuse integration.
- **Cross-repo sequencing / deploy ordering**: changes that will break if the repos are deployed independently or in the wrong order.
- **Backward / forward compatibility**: whether one side's change is rolled out safely with respect to the other side during deploy.

### What NOT to do

- **Do NOT** re-review single-repository concerns (intra-repo logic errors, local style, per-file bugs). Those are already covered by the per-repository reviewers — avoid duplicating their work.
- **Do NOT** perform any git merge, PR merge, or branch merging operations.

### Review Scope

Each repository section may carry a **New Work** block: that repository's own commits since the review named there. When any repository has one, the unit you decide about is the **boundary**, not the file:

- Report a boundary where **either side** appears in a New Work block. One side moving is enough — that is the case where an agreement that used to hold can have stopped holding.
- A boundary where **neither** side has moved since that review was already judged in that earlier session, by a reviewer with the same two worktrees in front of it. Re-deriving it spends a cycle re-deciding a settled question, and the run has a bounded number of cycles. Leave it alone even if a fresh reading suggests something new.
- **Read both sides in full, freely.** Most of what establishes a contract mismatch — the schema, the producer's converters, the consumer's call sites — is unchanged by definition, and you cannot judge a boundary from a diff. The narrowing is on what you *report*, never on what you may read.
- A repository whose block says it has **no usable baseline** is entirely in scope, the same as a repository with no block at all.
- When **no** New Work block is present anywhere, every boundary is in scope — this is the first review of the branch.

### Execution Steps

1. For each repository, review the provided changes (branch, changed files, diff stat, commit log), and note which of them carry a **New Work** block — that is what decides which boundaries you report on.
2. Read actual files across the different worktrees as needed to confirm whether the two sides agree. You may \`cd\` between worktree paths (each as its own Bash call, \`cd\` alone — never combined with \`&&\` or \`;\`).
3. Identify concrete cross-repository issues. For each, name the specific repos involved and the exact symbol / endpoint / field.
4. Categorize findings:
   - **Critical Issues** (must fix): contract mismatches that will break at runtime, data loss, incompatible deploys.
   - **Warnings** (should address): drift or inconsistencies likely to cause bugs or confusion.
   - **Suggestions** (nice-to-have): opportunities to share types / extract a common contract.
5. Write the review report to the specified file path.

${REVIEW_COVERAGE_POLICY}

Coverage here means coverage of **cross-repository** concerns only — reporting everything you find does not license re-reviewing single-repo issues that the per-repository reviewers already cover.

${SEVERITY_CALIBRATION}

${RECURRING_FINDINGS_POLICY}

Most entries you see on that list will be cross-repo escalations, because those are the findings no single cycle can clear: a contract another team owns, a criterion the two sides cannot satisfy together. Compressing them is the point — the escalation is already recorded in that ledger, and it is carried from there rather than re-argued here.

${WRITTEN_DELIVERABLE_LENGTH}

### Language

- **Always write all output in English**, regardless of the language used in the workspace README.

### Guidelines

- Be specific: reference the exact repos, files, and line numbers on both sides of each mismatch.
- If there are no cross-repository issues, say so explicitly — an empty/clean cross-repo report is a valid and useful result.
`;
}

/**
 * The repo's own work since the previous review, rendered under its section.
 *
 * The full branch stays above it: a boundary is judged against both sides as they
 * now stand, so unlike the per-repo reviewer this never replaces the branch with a
 * range — it only marks which part of it is new.
 */
function newWorkBlock(scope: CrossRepositoryReviewerInput["repos"][number]["reviewScope"]): string {
  if (!scope) {
    return `New Work: no usable baseline for this repository — its whole branch is in scope.`;
  }
  if (!scope.hasChanges) {
    return `New Work since review ${scope.sinceTimestamp} (\`${scope.sinceSha}\`): none — this repository has not been touched since then.`;
  }
  return `New Work since review ${scope.sinceTimestamp} (\`${scope.sinceSha}\`):

Changed files:
${scope.changedFiles}

Diff stat:
${scope.diffStat}

New commits:
${scope.commitLog}`;
}

/**
 * Workspace-level statement of what the per-repo New Work blocks mean, rendered
 * only from the second review of a branch onward (the first has no baseline).
 */
function boundaryScopeSection(input: CrossRepositoryReviewerInput): string {
  const scopes = input.repos.map((r) => r.reviewScope);
  if (scopes.every((s) => !s)) return "";

  const sinceTimestamp = scopes.find((s) => s)?.sinceTimestamp ?? "";
  // Only claimable when every repo reported a usable range: a repo without one
  // may have moved for all we know, and reading that as "unchanged" would retire
  // a boundary nobody looked at.
  const nothingMoved = scopes.every((s) => s && !s.hasChanges);

  const body = nothingMoved
    ? `**No repository has changed since review ${sinceTimestamp}.** No boundary between them can newly have broken, so there is no new cross-repository surface to review. Say that, carry the recurring findings if there are any, and stop.`
    : `Report a boundary where **either side** appears in a New Work block below. A boundary whose two sides have both been untouched since review ${sinceTimestamp} was already judged then — do not re-derive it. Read anywhere you need to; the narrowing is on what you report.`;

  return `## Boundary Scope

${body}

`;
}

export function buildCrossRepositoryReviewerPrompt(input: CrossRepositoryReviewerInput): string {
  const anyScope = input.repos.some((r) => r.reviewScope);
  const repoSections = input.repos
    .map(
      (r) => `### ${r.repoName}

- Repository: ${r.repoPath}
- Base Branch: ${r.baseBranch}
- Worktree: ${r.worktreePath}

Changes${anyScope ? " (whole branch)" : ""}:

${r.repoChanges}${anyScope ? `\n\n${newWorkBlock(r.reviewScope)}` : ""}`,
    )
    .join("\n\n---\n\n");

  return `# Task: Cross-repository review for workspace ${input.workspaceName}

## Workspace: ${input.workspaceName}
## Review Timestamp: ${input.reviewTimestamp}

## Workspace README

${input.readmeContent}
${knownFindingsSection(input.knownFindings)}
${boundaryScopeSection(input)}## Repositories and their changes

${repoSections}

## Review Report

Write the cross-repository review report to: ${input.reviewFilePath}

Focus ONLY on issues that span more than one of the repositories above. Single-repository concerns are reviewed separately — do not repeat them here.${
    // Restated here on purpose: this is the last instruction read, and the
    // Boundary Scope section is far above it by the time the repo diffs are done.
    anyScope
      ? ` And only on boundaries where at least one side appears in a **New Work** block above — the rest were judged in an earlier session.`
      : ""
  }
`;
}
