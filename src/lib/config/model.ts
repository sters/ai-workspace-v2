import type { ClaudeEffort, ClaudeModel } from "@/types/claude";
import { CLAUDE_MODELS } from "@/types/claude";
import type { OperationType } from "@/types/operation";
import type { StepType } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import { getConfig } from "./resolver";

/**
 * Code-level default models per step type.
 * These are the lowest-priority defaults — config overrides them.
 *
 * This table and `STEP_DEFAULT_EFFORTS` are two halves of one ordered ladder,
 * cheapest rung first:
 *
 *   haiku-5.5/low  — reshaping text already handed over: merge, filter, dedupe
 *   sonnet-5.5/low — mechanical, or bounded work with nothing to judge
 *   opus/low       — a step above mechanical: shallow judgment over a bounded input
 *   opus/medium    — the default rung, open-ended work included
 *   opus/high      — a short call whose wrong answer costs a whole cycle
 *
 * Only those five pairings exist, and `effort.test.ts` fails on a sixth. Keep the
 * two tables in sync: a step listed in one and not the other is a drift bug.
 *
 * The smaller models are pinned to full IDs because the CLI resolves the bare
 * `sonnet` and `haiku` aliases to a previous generation.
 */
export const STEP_DEFAULT_MODELS: Partial<Record<StepType, ClaudeModel>> = {
  // Opus — everything that needs judgment, i.e. the three upper rungs. The
  // effort table is what separates them.
  [STEP_TYPES.ANALYZE_README]: "opus",
  [STEP_TYPES.PLAN_TODO]: "opus",
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "opus",
  [STEP_TYPES.EXECUTE]: "opus",
  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "opus",
  [STEP_TYPES.VERIFY_README]: "opus",
  [STEP_TYPES.CRITERIA_FEASIBILITY]: "opus",
  [STEP_TYPES.VALIDATE_PR_COMMENT]: "opus",
  [STEP_TYPES.GROUND_FINDING]: "opus",
  [STEP_TYPES.RESOLVE_CONFLICTS]: "opus",
  [STEP_TYPES.CODE_REVIEW]: "opus",
  [STEP_TYPES.REVIEW_TODOS]: "opus",
  [STEP_TYPES.COORDINATE_TODOS]: "opus",
  // `research` covers all three research phases (per-repo + cross-repo
  // findings, recommendations, integration) — the findings phases are the
  // deliverable of the whole operation, not a step toward one.
  [STEP_TYPES.RESEARCH]: "opus",
  // Both rewrite workspace documents that later phases treat as authoritative:
  // the TODO list the executor consumes and the gate audits, and the README
  // done-contract the verifier and gate enforce.
  [STEP_TYPES.UPDATE_TODO]: "opus",
  [STEP_TYPES.UPDATE_README]: "opus",
  // Not just a decision: on `synthesize` this same call merges the candidates'
  // implementations into the original worktree, and everything downstream
  // builds on the result.
  [STEP_TYPES.BEST_OF_N_REVIEWER]: "opus",
  // Decides whether to run another cycle. Not open-ended work — it reads an
  // already-structured review summary — but it is the only step tiered by
  // payoff: one short call, and a wrong answer either burns a whole cycle or
  // stops with work unfinished. Given that it earns `high` effort, it gets opus
  // too; see the note on the smaller models below.
  [STEP_TYPES.AUTONOMOUS_GATE]: "opus",
  [STEP_TYPES.SUGGEST_WORKSPACE]: "opus",
  [STEP_TYPES.README_CLARITY_GATE]: "opus",
  [STEP_TYPES.VERIFY_FIXES]: "opus",

  // Sonnet and haiku — the two bottom rungs, and only those: work with nothing
  // to decide. Both pair exclusively with `low` effort, which is the whole reason
  // to reach for a smaller model — cheap throughput on mechanical work. A smaller
  // model at `medium` or `high` is a rung this ladder does not have: paying more
  // to make the weaker model think is the wrong trade, so anything above
  // mechanical goes to opus instead (`model.test.ts` enforces this).
  //
  // Sonnet takes the steps that still act like an agent — search the
  // workspaces, check items against the code, drive gh/git, or splice whole
  // documents. At `low` it can report done without checking and stop to ask
  // partway, which is why the executor and every step that writes code stay on
  // opus.
  [STEP_TYPES.VERIFY_TODO]: CLAUDE_MODELS.SONNET_5_5,
  [STEP_TYPES.DEEP_SEARCH]: CLAUDE_MODELS.SONNET_5_5,
  // Fills a PR template from the diff and README, plus the gh/git mechanics.
  [STEP_TYPES.CREATE_PR]: CLAUDE_MODELS.SONNET_5_5,
  // The markdown best-of-N pair (`best-of-n-files.ts`): pick a winner, then
  // splice documents together. No code is involved in either.
  [STEP_TYPES.BEST_OF_N_FILE_REVIEWER]: CLAUDE_MODELS.SONNET_5_5,
  [STEP_TYPES.BEST_OF_N_SYNTHESIZER]: CLAUDE_MODELS.SONNET_5_5,
  // Haiku takes the steps whose input is a named set of files in one place:
  // read them, merge or filter by the prompt's rules, write the result. Nothing
  // to explore keeps the prompt short, which is where haiku holds up — a long
  // agent prompt at `low` makes it skip checks and stop early — and keeps the
  // request under the prompt length where its price steps up.
  [STEP_TYPES.PRUNE_SUGGESTIONS]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.COLLECT_REVIEWS]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.AGGREGATE_SUGGESTIONS]: CLAUDE_MODELS.HAIKU_5_5,
};

/**
 * Code-level default `--effort` levels per step type.
 *
 * Effort — not the model tier — is the primary cost/latency dial, so every step
 * declares one explicitly rather than inheriting the CLI default. Both tables
 * cover every `STEP_TYPES` value, so adding a step type forces a tier choice
 * (enforced by `effort.test.ts`).
 *
 * `medium` is the default tier, and it covers open-ended work as well as bounded
 * work: on the current Opus, `medium` reaches what `high` did on the previous
 * one. A step moves off it only for a stated reason:
 *   high   — a short call whose wrong answer costs a whole autonomous cycle, so
 *            extra thinking is cheap insurance. Kept to the gate on purpose.
 *   low    — there is little to think about: extraction, aggregation, or rule
 *            application over already-structured text.
 *
 * Note that a step's *importance* is not a reason for `high`. Nearly every step
 * here feeds something downstream that treats its output as authoritative, so
 * "the pipeline enforces this as fact" argues for high everywhere and therefore
 * discriminates nothing. Open-endedness is not a reason either: `code-review`
 * hunts defects nobody has enumerated and `plan-todo` decides how to reach
 * "done", and both are on `medium`. Raise a step via config where a run needs
 * more depth.
 *
 * `xhigh` and `max` are intentionally absent: they are worth reaching for on a
 * specific hard workload, measured, via config — not as a blanket default.
 */
export const STEP_DEFAULT_EFFORTS: Partial<Record<StepType, ClaudeEffort>> = {
  // The one step tiered by payoff rather than shape: it reads an already
  // structured summary, but it is a single short call and a wrong answer costs a
  // whole cycle — a needless loop, or stopping with work unfinished.
  [STEP_TYPES.AUTONOMOUS_GATE]: "high",

  // Open-ended: the answer is not latent in the input. `analyze-readme` /
  // `plan-todo` decide what "done" means and how to get there, `research` is the
  // deliverable of its operation, `coordinate-todos` reads the other repos'
  // source to resolve placeholders.
  [STEP_TYPES.ANALYZE_README]: "medium",
  [STEP_TYPES.PLAN_TODO]: "medium",
  [STEP_TYPES.RESEARCH]: "medium",
  [STEP_TYPES.COORDINATE_TODOS]: "medium",
  [STEP_TYPES.BEST_OF_N_REVIEWER]: "medium",
  // Reads like translation — the gate's numbered asks become items — but the two
  // things it must derive are enumerated nowhere: which sites *state* a contract an
  // ask changes, and which of the sites its own items touch need coverage. It hands
  // straight to an executor in the same run, so a gap it leaves comes back as the
  // next review's findings and costs a cycle.
  [STEP_TYPES.UPDATE_TODO]: "medium",
  // Hunts defects nobody enumerated, and is the critical path of every review
  // phase. The harness around it owns much of the job: `REVIEW_COVERAGE_POLICY`
  // asks for breadth rather than adjudication, `SEVERITY_CALIBRATION` supplies
  // the labels, the `Verify constraints` phase owns lint/test/build, and
  // **Incremental review scope** narrows it to the diff since the last review.
  // Raise it via `operations.review.steps.code-review.effort` where a run needs
  // more depth.
  [STEP_TYPES.CODE_REVIEW]: "medium",

  // The TODO the executor consumes is already a plan: the planning steps above
  // decided what to build and later phases verify the result, so this is bounded
  // implementation, not open-ended investigation. It is also the longest-running
  // step in the pipeline and runs once per batch per repo, so it dominates both
  // wall clock and spend.
  [STEP_TYPES.EXECUTE]: "medium",
  // Verifies against the enumerated `## Acceptance Criteria` checkboxes, which
  // the prompt treats as the authoritative requirement set.
  [STEP_TYPES.VERIFY_README]: "medium",
  // Same shape as verify-readme and sized to match: the criteria list is
  // enumerated, so the question is bounded — but answering it means reading the
  // other repositories' source to see whether the contract can carry the data at
  // all, which is more than the `readme-clarity-gate` rung below does.
  [STEP_TYPES.CRITERIA_FEASIBILITY]: "medium",
  // One bounded question — does this one review comment hold? — but answering it
  // means reading unfamiliar code to check a claim, which is what puts it here
  // rather than on the `readme-clarity-gate` rung below. The comment states what
  // to look at, so the search is directed rather than an open hunt. A human
  // presses the button and reads the verdict, so a wrong one costs a second
  // look, not a cycle.
  [STEP_TYPES.VALIDATE_PR_COMMENT]: "medium",
  // The mirror of validate-pr-comment, pointed outward: does *our* review finding
  // hold against the pushed code, and does it deserve a comment on the PR. Same
  // shape, so the same rung — the finding names the file and the claim, so the
  // search is directed. What makes a wrong answer here more expensive than
  // validate's is that nobody reads it before it reaches someone else's PR,
  // which the prompt's bias toward `unclear` answers rather than a rung.
  [STEP_TYPES.GROUND_FINDING]: "medium",
  // Writes the merged content of an enumerated set of conflicted files, which is
  // bounded implementation like `execute`: git has already named every file and
  // marked both sides, so the work is deciding what the two intents come to
  // rather than hunting for anything. What keeps it off the rung below is that a
  // conflict is routinely a symptom — the base renamed or moved what this branch
  // edited — so resolving inside the markers alone produces a file that merges
  // and does not work.
  [STEP_TYPES.RESOLVE_CONFLICTS]: "medium",
  // Applies a requested edit to one document, and is forbidden from touching code.
  // The document it rewrites is the run's done-contract, but the edit itself is
  // named in the request and lands in one file, so there is nothing to enumerate.
  [STEP_TYPES.UPDATE_README]: "medium",
  // Turns review findings into TODO items, the same shape of work as `update-todo`.
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "medium",
  [STEP_TYPES.REVIEW_TODOS]: "medium",
  // Proposes the candidate work items itself rather than reading them off an
  // input, so unlike the rungs below there is nothing to translate from.
  [STEP_TYPES.SUGGEST_WORKSPACE]: "medium",

  // opus/low — a step above mechanical: shallow judgment over a bounded input.
  // Reads version-pinning files, lockfiles and task runners and copies the
  // lint/test/build commands into a fixed one-per-line format, but has to decide
  // *which* package manager and activation command apply.
  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "low",
  // A single yes/no against documented criteria, and deliberately biased toward
  // proceeding — it is a safety valve, not a quality bar.
  [STEP_TYPES.README_CLARITY_GATE]: "low",
  // Checks an enumerated list of requested fixes against the code — bounded, like
  // `verify-todo` on the rung below. It sits here rather than there because the
  // asks are free-form prose rather than structured TODO items, and because a
  // `NOT LANDED` verdict is a hard loop reason for the gate: a false negative
  // costs a cycle, a false positive lets requested work disappear.
  [STEP_TYPES.VERIFY_FIXES]: "low",

  // sonnet/low and haiku/low — nothing to decide: extraction, aggregation, rule
  // application. See `STEP_DEFAULT_MODELS` for which model takes which.
  [STEP_TYPES.CREATE_PR]: "low",
  // Comparative judgment, but over prose, with no code and nothing to merge.
  [STEP_TYPES.BEST_OF_N_FILE_REVIEWER]: "low",
  [STEP_TYPES.BEST_OF_N_SYNTHESIZER]: "low",
  [STEP_TYPES.VERIFY_TODO]: "low",
  [STEP_TYPES.DEEP_SEARCH]: "low",
  // Applies the prompt's documented rules to an existing suggestion list.
  [STEP_TYPES.PRUNE_SUGGESTIONS]: "low",
  [STEP_TYPES.COLLECT_REVIEWS]: "low",
  [STEP_TYPES.AGGREGATE_SUGGESTIONS]: "low",
};


/**
 * Resolve the Claude model to use for a given operation type and step.
 *
 * Priority (highest to lowest):
 * 1. `explicitModel` — phase/child direct override
 * 2. `config.operations.typeOverrides[operationType].steps[stepType].model`
 * 3. `config.operations.typeOverrides[operationType].model`
 * 4. `config.operations.model`
 * 5. `STEP_DEFAULT_MODELS[stepType]` — code-level step defaults
 * 6. `undefined` — let CLI use its default
 */
export function resolveModel(
  operationType: OperationType,
  stepType?: StepType,
  explicitModel?: ClaudeModel,
): ClaudeModel | undefined {
  if (explicitModel) return explicitModel;

  const cfg = getConfig();
  const typeOverride = cfg.operations.typeOverrides?.[operationType];

  if (stepType && typeOverride?.steps?.[stepType]?.model) {
    return typeOverride.steps[stepType].model;
  }

  if (typeOverride?.model) {
    return typeOverride.model;
  }

  if (cfg.operations.model) {
    return cfg.operations.model;
  }

  if (stepType) {
    return STEP_DEFAULT_MODELS[stepType];
  }

  return undefined;
}

/**
 * Resolve the Claude CLI `--effort` level for a given operation type and step.
 *
 * Mirrors `resolveModel`'s priority chain:
 * 1. `explicitEffort` — phase/child direct override
 * 2. `config.operations.typeOverrides[operationType].steps[stepType].effort`
 * 3. `config.operations.typeOverrides[operationType].effort`
 * 4. `config.operations.effort`
 * 5. `STEP_DEFAULT_EFFORTS[stepType]` — code-level step defaults
 * 6. `undefined` — let CLI use its default
 */
export function resolveEffort(
  operationType: OperationType,
  stepType?: StepType,
  explicitEffort?: ClaudeEffort,
): ClaudeEffort | undefined {
  if (explicitEffort) return explicitEffort;

  const cfg = getConfig();
  const typeOverride = cfg.operations.typeOverrides?.[operationType];

  if (stepType && typeOverride?.steps?.[stepType]?.effort) {
    return typeOverride.steps[stepType].effort;
  }

  if (typeOverride?.effort) {
    return typeOverride.effort;
  }

  if (cfg.operations.effort) {
    return cfg.operations.effort;
  }

  if (stepType) {
    return STEP_DEFAULT_EFFORTS[stepType];
  }

  return undefined;
}
