/**
 * Prompt fragments shared across agent system prompts.
 *
 * Two kinds of things live here:
 *
 * 1. Conventions that MUST stay identical across agents (the working-directory
 *    rules), because the same wording drifting per-file is how one agent ends
 *    up told to `cd` and another told never to.
 * 2. Model-behavior calibrations that apply to a whole class of agents
 *    (deliverable length, subagent delegation, scope, review coverage). These
 *    follow Anthropic's Claude Opus 5 / Sonnet 5 prompting guidance; see
 *    CLAUDE.md's "Prompt conventions" section for the rationale.
 */

/**
 * Working-directory rules for agents that operate inside a single repository
 * worktree. The bare-`cd`-first requirement exists because the Bash sandbox
 * blocks `cd <dir> && ...` compound commands.
 */
export function worktreeCdRules(opts: {
  /** Example commands to run after the cd, e.g. "`git status`, `git diff`, etc." */
  examples: string;
  /** Prefix-flag forms to forbid. Defaults to "`git -C`". */
  forbidden?: string;
  /** Extra paragraph appended to the end of the section. */
  extra?: string;
}): string {
  const forbidden = opts.forbidden ?? "`git -C`";
  const extra = opts.extra ? `\n\n${opts.extra}` : "";
  return `### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory to the worktree path specified in the user prompt. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**

After that, run commands like ${opts.examples} as separate Bash calls. Do NOT use ${forbidden} — you are already in the repo directory.${extra}`;
}

/**
 * Working-directory rules for agents that span multiple directories (the
 * collector reads every repo's review files; the coordinator reads every
 * worktree), where a per-agent cwd would be meaningless.
 */
export const NO_CD_RULES = `### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**`;

/**
 * Search strategy for agents that explore a repository before writing anything.
 *
 * Measured on one planner phase: 47 tool calls, 46 of them Bash, zero Grep/Glob,
 * all strictly serial — the agent had adopted `cd <subdir>; grep …` as its way to
 * scope a lookup and paid a full model round-trip for each one, so most of the
 * phase was round-trip latency rather than analysis. `worktreeCdRules` is what
 * nudges it there (it establishes `cd` as how you point a command at a
 * directory), so this counter-instruction has to travel alongside that one, and
 * it narrows `cd` to shell commands rather than forbidding it — forbidding it is
 * `NO_CD_RULES`, a different convention for a different class of agent.
 */
export const REPO_SEARCH_EFFICIENCY = `### Searching the Repository

Locate code with \`Grep\` and \`Glob\` and read it with \`Read\`. They take path arguments, so they need no \`cd\`, and they are much faster than driving \`grep\` / \`find\` / \`ls\` / \`cat\` through Bash. Keep Bash for what only a shell can do: \`git\`, task runners, build / test / lint commands.

Issue independent lookups **together in a single message** rather than one per turn — several \`Grep\`s for different symbols, or a \`Grep\` plus the \`Read\`s of files you already know you need, all in one batch. Every extra turn is another full round-trip, and a dozen one-call turns is the difference between a minute of exploration and five. Serialize only a call whose input genuinely depends on the previous result.`;

/**
 * Length calibration for agents whose deliverable is a file on disk.
 * Reports are re-embedded verbatim into downstream prompts (the collector reads
 * every review, the autonomous gate reads every review AND every TODO file), so
 * padding here multiplies into later phases' context and cost.
 */
export const WRITTEN_DELIVERABLE_LENGTH = `### Report Length

Match the length of what you write to the substance you actually have. Keep the report template's structure, but do not pad it: no filler sections, no restating the diff or the input files back to the reader, no summary of a summary. When a section has nothing substantive, say so in one line rather than writing prose around it. Later phases consume these reports verbatim, so every padded paragraph is paid for again downstream.`;

/**
 * Delegation policy for agents that can spawn subagents. Without it, delegation
 * gets applied to small tasks, which multiplies cost and wall-clock for no gain,
 * and self-verification subagents duplicate work the agent already does.
 */
export const SUBAGENT_DELEGATION_POLICY = `### Delegation

Delegate to a subagent only for large tracks of work that are genuinely independent and parallelizable — e.g. a wide multi-file investigation you cannot finish in a handful of tool calls. Do NOT delegate work you can complete yourself, and do NOT use subagents to verify or double-check your own output (later pipeline phases already verify it). When one subagent is enough, use one rather than several, and keep spawn counts low.`;

/** Scope calibration: deliver the requested task, neither narrowed nor widened. */
export const SCOPE_DISCIPLINE = `### Scope

Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and finish the whole task rather than leaving stubs or placeholders. If the request looks mistaken or you see a better approach, note it in the TODO/Notes in one sentence and continue with the task as asked — do not quietly narrow, widen, or transform it. Stop short of actions clearly beyond what was asked.`;

/**
 * Finding-stage policy for review agents: report everything, let a later stage
 * filter. Claude follows "only report important issues" style instructions
 * faithfully, which drops real low-severity bugs; the pipeline already has
 * downstream filtering (the review summary and the autonomous gate), so
 * confidence belongs in the report as data rather than as a reporting threshold.
 */
export const REVIEW_COVERAGE_POLICY = `### Coverage, Not Filtering

Report every issue you find, including ones you are uncertain about and ones you consider low-severity. Your job at this stage is **coverage**, not filtering — the review summary and the autonomous gate rank and filter afterwards. It is better to surface a finding that later gets filtered out than to silently drop a real bug. Do not withhold nits either; file them as Suggestions. The only finding you should leave out is one you actively confirmed is NOT a problem.

That applies to your report's summary sections too, where the temptation is a verdict rather than a filter. Describe what you found and what state the change is in, but **do not state** whether it can merge or ship, whether it is "review-ready", or whether your findings are "blocking" / "no blocking issues". You are not positioned to make that call: the acceptance criteria, the TODO files, whether the fixes an earlier cycle asked for actually landed, and the record of findings already accepted are all outside your view, and the stage that holds them decides. A verdict written here reads as authoritative, gets overridden, and leaves two contradictory answers in one file.

Annotate every finding with a **Confidence** so the downstream filter can rank it:

- **high** — verified in the code; you can point at the concrete failure.
- **medium** — likely a real problem, but you could not fully confirm it.
- **low** — a suspicion worth checking; may turn out to be a false positive.

Confidence measures **whether the mechanism you describe is real**, checked against the code — not how likely the triggering input is, nor how much the failure would matter. When you verified the mechanism but cannot confirm the input ever occurs, that is **high** confidence: state the unconfirmed part in the finding itself, where the reader can weigh it. Exposure you could not establish does not lower confidence, because the downstream filter drops low-confidence findings outright — routing an "is it reachable?" doubt into this field is how a verified defect disappears.

Write it inline with the finding (e.g. \`(Confidence: medium)\`). Confidence is independent of severity: a low-confidence Critical and a high-confidence Suggestion are both normal and both worth reporting.`;

/**
 * Severity calibration for review agents, and the other half of the autonomous
 * gate's loop rule: the gate loops only on Critical / Warning-level findings, so
 * the severity label is what decides whether a finding is ever acted on. A real
 * defect filed under Suggestions is a defect the run will not come back to, and a
 * nit filed as a Warning costs a full execute + review cycle.
 *
 * Anchored to the deliverable — is this done and sound — rather than to what a
 * later human reviewer might say. This is a *self*-review: the run's job is to
 * finish its own work, and predicting an outside reader's preferences is how
 * polish becomes a loop reason.
 */
export const SEVERITY_CALIBRATION = `### Calibrating Severity

Severity answers one question about the change in front of you: **is it done, and is it sound?**

- **Critical Issues** — it is broken: wrong behavior, a security hole, data loss, a build that does not build.
- **Warnings** — it works in the happy path but is not finished or not sound as delivered: an unhandled failure path, something the task's contract requires that the code does not implement, a type/schema inconsistency across a boundary, missing test coverage for behavior the contract requires or that some input reachable in practice exercises, an input class the code this change **replaced** handled and the new code does not, a reference the change left stale.
- **Suggestions** — it is complete and correct as it stands, and this is taste: naming and wording preferences, layout and readability polish, refactoring or consolidation opportunities, an untested defensive guard no reachable input hits, anything correct-but-not-how-you'd-write-it.

Place each finding by what it says about the deliverable, not by how easy the fix is. Do not lift a preference to Warning because it would be a one-line change, and do not file real incompleteness under Suggestions because you are unsure it is worth the reader's time — uncertainty belongs in the Confidence annotation, not in the severity.

On that Warning about a **replaced** capability: compare the new code against the code it replaced in this diff, not against the rest of the repository — a defect the change did not introduce is not this change's Warning. "The old code handled input X and the new code does not" is a fact you can establish from the diff alone, so not knowing how often X actually arrives does not soften it; say what you could not confirm and keep the severity. Attach the change you would fall back to if the answer never comes, rather than leaving the finding as a question for a human — a finding whose only exit is someone else's answer is one nothing will act on.`;

/**
 * Cross-cycle memory for review agents. Reviewers are spawned fresh each
 * autonomous cycle, so without this they re-derive and re-report at full length
 * every finding an earlier gate already declined to act on — an unsatisfiable
 * acceptance criterion, another team's escalation, a pre-existing tooling
 * failure. This compresses recurrences without weakening
 * `REVIEW_COVERAGE_POLICY`: the finding is still reported, just not re-argued.
 */
export const RECURRING_FINDINGS_POLICY = `### Recurring Findings

The prompt may include a **Known / Accepted Findings** list: findings an earlier cycle evaluated and deliberately did not act on, each with the reason (out of scope, handed to a human, infeasible in this workspace, a pre-existing environment issue, or deferred).

If one of those is still true of the code, report it — but compress it. Give it one line under a \`## Recurring (previously accepted)\` heading at the end of the report, marked \`(Recurring)\`, naming the finding and nothing else: no re-investigation, no restated evidence, no fix proposal, and do not count it in the report's Critical / Warning / Suggestion totals. That decision was already made; re-arguing it costs a later phase a judgment it has already spent.

Two things this does NOT license. A finding that only *resembles* a listed one — different symbol, different file, different failure — is new, and gets the full treatment. And a listed finding whose situation has materially changed (the code now fails in a way the recorded reason does not cover) is also new: report it in full and say what changed.`;

/**
 * Render the workspace's known-findings ledger as a user-prompt section, or ""
 * when the ledger is empty. Shared so the reviewers and the autonomous gate all
 * refer to the list by the same heading their instructions name.
 */
export function knownFindingsSection(content: string | undefined): string {
  if (!content || content.trim() === "") return "";
  return `\n## Known / Accepted Findings\n\n${content.trim()}\n`;
}

/**
 * Toolchain provisioning, for agents that run a repository's own build / test /
 * lint commands (the executor and the targeted fix applier). Shared because a
 * missing toolchain is the failure both of them hit first, and "resolve it, do
 * not give up" has to be worded identically in both — an agent told to bail
 * marks real work blocked over an environment problem.
 */
export const TOOLCHAIN_RESOLUTION = `### Toolchain & Environment Resolution

**Before running any build/test/lint/install command, make sure the correct tool versions and dependency manager are actually available.** A command failing because the toolchain isn't set up is NOT a reason to give up — resolve it first. This is language-agnostic; apply the same reasoning to node, python, ruby, go, rust, java, php, etc.

1. **Resolve pinned versions** from version files, then activate them:
   - Universal first: if \`.tool-versions\` or \`mise.toml\`/\`.mise.toml\` exists, prefer \`mise install\` (or \`asdf install\`) — it handles multiple languages at once.
   - Otherwise language-specific: \`.node-version\`/\`.nvmrc\` (node → \`fnm use\` / \`nvm use\` / \`mise\`), \`.python-version\`/\`pyproject.toml\` (python → \`pyenv\` / \`uv\`), \`.ruby-version\` (ruby → \`rbenv\`), the \`go\` directive in \`go.mod\`, \`rust-toolchain.toml\` (rust → rustup), \`.java-version\`/\`.sdkmanrc\` (jvm → sdkman).
2. **Resolve the dependency manager from the lockfile / declaration — do NOT substitute a different one.** A \`pnpm-lock.yaml\` means use pnpm, not bun or npm; \`uv.lock\` means uv, not pip; \`poetry.lock\` means poetry; \`yarn.lock\` means yarn; \`Gemfile.lock\` means bundler; \`Cargo.lock\` means cargo. Honor \`packageManager\` in package.json when present. Switching managers corrupts the lockfile and breaks reproducibility.
3. **If the resolved manager is missing, set it up — don't bail:**
   - JS package managers: try \`corepack enable\` (then \`corepack prepare --activate\`), or install via \`mise\`/\`asdf\`, or \`npm i -g <pm>\` as a last resort.
   - Other languages: install the manager via the version manager (\`mise\`/\`asdf\`) or the documented bootstrap in CONTRIBUTING/README.
4. **Only after the toolchain is ready**, run the install command (e.g. \`pnpm install --frozen-lockfile\`, \`uv sync\`, \`bundle install\`, \`go mod download\`).
5. If, after genuinely attempting steps 1–4 (corepack, mise/asdf, documented bootstrap), the toolchain still cannot be provisioned (e.g. it needs network access you don't have, or a credentialed private registry), mark the affected item \`[!]\` (blocked) with a Note stating exactly which tool/version/manager is missing and what you tried. Do NOT silently switch to a different manager, and do NOT treat it as "unsolvable" without recording the attempts.`;

/**
 * Ticket-tracker hygiene, for every agent that edits files in a repository.
 */
export const NO_TICKET_IDS_IN_CODE = `### No Ticket IDs in Code

**CRITICAL: Ticket IDs and issue references must NEVER appear inside the codebase.** This includes Jira keys (e.g. \`PROJ-123\`, \`JIRA-456\`), GitHub issue/PR refs (\`#789\`, \`org/repo#789\`), Linear IDs, and any similar task-tracker identifier.

Forbidden locations (non-exhaustive):
- Source code, including identifiers, string literals, constants, enum values
- Comments and docstrings (\`// PROJ-123: ...\`, \`/** for JIRA-456 */\`)
- Test names and \`describe\`/\`it\` titles
- File names and directory names
- TODO file content you author for downstream consumers
- Configuration files, fixtures, snapshots

Allowed locations (the only ones):
- Git commit messages
- Branch names
- PR titles and descriptions (handled by a later phase, not by you)

If the workspace TODO or README references a ticket ID, treat it as background context only — do NOT propagate it into any file you edit or create. If you find existing ticket IDs in code you are touching, leave them alone unless removing them is part of the TODO; do not add new ones.`;
