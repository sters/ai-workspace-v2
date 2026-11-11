# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for a multi-repository workspace manager for Claude Code. Browser UI on `localhost:3741` to view workspaces (README, TODOs, reviews, changes, PRs, artifacts) and trigger operations (init, execute, review, create-pr, autonomous, …) that run `claude -p --output-format stream-json` via `Bun.spawn`. WebSocket chat server on port 3742 for interactive Claude sessions; optional Slack bot.

## Commands

```bash
bunx github:sters/ai-workspace-v2 [/path/to/ai-workspace]  # Run via bunx
bun install
bun run dev:hot                 # Development with hot reload
bun run start:build             # Production build + start
bun run lint                    # next typegen + tsc (tsconfig.typecheck.json) + eslint src/
bun run test                    # All tests
bun --bun vitest run src/__tests__/lib/parsers/todo.test.ts  # Single file (--bun required for bun:sqlite)
bun run bench --root ~/ai-workspace --workspace <ws> --step verify-completion --configs opus/medium,claude-haiku-5-5/xhigh  # billed; answers go to .ai-workspace/bench/, read and compare them; --list, --dry-run
bun run bench:execute --root ~/ai-workspace --workspace <ws> --repo <worktree> --configs opus/medium,claude-sonnet-5-5/high  # billed; reruns the planned TODO from the commit it started on, in sandbox worktrees; writes patch, commits, TODO and constraint results per attempt
```

## Configuration

`{workspaceRoot}/.ai-workspace/config.yml`; priority env > config.yml > defaults (`src/lib/config/resolver.ts`, cached on `globalThis`). Workspace root: CLI arg > `AIW_WORKSPACE_ROOT` > cwd. Env vars: `AIW_WORKSPACE_ROOT`, `AIW_PORT` (3741), `AIW_CHAT_PORT` (3742), `AIW_CLAUDE_PATH`, `AIW_DISABLE_ACCESS_LOG`. String values may use `{ENV:VAR_NAME}` (`env-substitution.ts`).

Notable keys: `operations.maxGroupConcurrency` (per parallel group, `getMaxGroupConcurrency()`), `operations.batchSize` (TODO groups per executor call), `operations.fetchIntervalMinutes` (reuse a clone fetched within N minutes, by `FETCH_HEAD` mtime; 0 = always fetch), `operations.defaultInteractionLevel`, `model` / `effort` (global, per operation, per step), `openers`, `hooks.*`, `suggest.enabled`, `slack.*`. When changing per-step defaults, update `TYPE_OVERRIDE_HINT_LINES` (`src/lib/config/migration.ts`).

## Architecture

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, SWR, Bun runtime.

- **Processes** — `bin/start.ts` spawns Next.js (`bin/next-server.ts`), the chat server (`bin/chat-server.ts`), the PR watcher (`bin/pr-watcher.ts`, unless `watcher.enabled: false`) and optionally the Slack bot (`bin/slack-server.ts`). `--hot` applies to all of them; each registers process-level state (signal handlers, timers, Slack connection) once, guarded on `globalThis`.
- **SQLite** — `.ai-workspace/db.sqlite` via `bun:sqlite` (`src/lib/db/`). Events are buffered and flushed asynchronously (`event-buffer.ts`). Each pipeline child's CLI-reported cost lands in `claude_runs` (written by `wire-child.ts`, kept past operation pruning) and is broken down at Utilities → Run Costs. A chat's cost is read on exit from its transcript's `cost-state` line (`chat-server/cost.ts`), which is why chats start with `--session-id`.
- **Pipelines** — an operation is a list of `PipelinePhase`s (single child, parallel group, or TS function) run by `startOperationPipeline()` (`src/lib/pipeline/orchestrator.ts`; max 3 concurrent). Definitions in `src/lib/pipelines/` (`build*Pipeline()`), reusable pieces in `pipelines/actions/`. Function phases get a `PhaseFunctionContext` (`emitStatus` / `emitResult` / `emitAsk` / `runChild` / `runChildGroup` / `appendPhases` / `setWorkspace` / `signal`). Phases have `maxRetries` (default 2) and `timeoutMs`. Interrupted operations are settled as failed on restart (`failStaleOperations()`), never resumed. Phase state travels as `__phaseUpdate:` / `__setWorkspace:` status events.
- **Claude CLI** — `src/lib/claude/cli.ts`. `allowedTools` replaces the patterns `addDirs` would generate (used to make agents read-only).
- **Model / effort** — `resolveModel()` / `resolveEffort()` (`src/lib/config/model.ts`): explicit > config (per-op per-step > per-op > global) > `STEP_DEFAULT_MODELS` / `STEP_DEFAULT_EFFORTS` > CLI default. Pick a step's default pairing from the published price list and cost-per-task benchmarks (e.g. artificialanalysis.ai, agentic-coding first), against what a wrong answer from that step costs; a smaller model at higher effort often beats a larger one at `low`, but higher effort can multiply generated tokens and wall clock. Measure a candidate with `bun run bench` before changing a default, and confirm on real runs in Run Costs. Both tables cover every step (`effort.test.ts`); when changing them, update `TYPE_OVERRIDE_HINT_LINES`. The smaller models are pinned to full IDs (`CLAUDE_MODELS.SONNET_5_5` / `HAIKU_5_5`) because the CLI's bare `sonnet` / `haiku` aliases resolve to a previous generation.
- **MCP server** — `/api/mcp` (`src/app/api/mcp/`) serves stateless MCP over Streamable HTTP, one JSON-RPC message per POST (`src/lib/mcp/protocol.ts`, hand-written, tools only). Operation tools call the existing routes' `POST`, so validation and defaults stay in the route; a new operation route gets a tool in `tools.ts`.
- **Validation** — Zod: `src/lib/schemas.ts` (HTTP bodies) and `src/lib/runtime-schemas.ts` (untrusted runtime data), kept separate.
- **Managed hooks** — `src/lib/claude/hooks/sync.ts` writes `aiw-`-prefixed hooks into `.claude/settings.local.json` on startup (git context on SessionStart; blocks `rm -rf /`, force push, `git reset --hard`). Non-`aiw-` hooks are preserved.

### Workspace model

- **README done-contract** (`src/lib/templates/readme.ts`) — `## Goal`, `## Non-Goal`, `## Assumptions`, `## Requirements`, `## Acceptance Criteria` (checkboxes tagged `(auto)` / `(manual)`, parsed by `parseAcceptanceCriteria()`). Verifiers and the autonomous gate treat it as authoritative, so prompts that write it must ground it in the request and never fabricate.
- **TODO files** — `TODO-<repo>.md` per worktree with `[ ]` / `[~]` / `[x]` / `[!]` (`src/lib/parsers/todo.ts`).
- **Artifacts** — `artifacts/` holds reviews (`reviews/<ts>/`, incl. `baseline.json`; its `VERIFY-README-*` / `VERIFY-TODO-*` and `SUMMARY.md` are rendered by code from the completion verifier's structured verdict and the reports' finding lists, `workspace/review-summary.ts`, so counts never disagree with items), `known-findings.md` (findings deliberately not acted on, read by reviewers and the gate), `repo-guidance/<repo>.md`, `pr-validations.json`, `finding-groundings.json`, `memo.md`.
- **Repository setup** — `setupRepository` / `setupRepositories` (`pipelines/actions/setup-repository.ts`). `repo:alias` gives another worktree of one clone. `setupRepositories` (init and quick create) fetches each clone once and checks out worktrees in parallel, with branch creation serialized per clone (`withCloneLock`: concurrent `worktree add -b` fail on the `.git/config` lock); a setup reaching a clone whose fetch or clone is in flight waits on that one instead of starting its own. A failed fetch proceeds on local refs; a failed clone is fatal.
- **Constraints** — `## Repository Constraints` in the README is written by constraint discovery (probes each tool, never runs lint/test/build; cached per clone in `.ai-workspace/repo-constraints/`; worktrees of one clone with the same key share one discovery; bump `FINGERPRINT_VERSION` when key rules change) and executed only by review's `Verify constraints` phase. A command may be scoped to the branch with `{base}` / `{changed_files}` plus a `(full: …)` fallback, expanded at run time (`workspace/constraint-scope.ts`); discovery decides per repository whether to scope.
- **Verification** — the Verify tab's scenarios, `artifacts/verification/<id>.json` (`src/lib/verification/`): ordered steps, each `claude` (a shell command; `background` for a server, with a `readyCommand`) or `human` (OK / NG, optional `inputs`), passing values through `{{variables}}`. Drafted and replanned by the `plan-verification` operation; run by `verification/runner.ts` outside the orchestrator, because a run waits on people and must survive a restart — the file is the whole state, each command gets its own process group, and background processes are recorded so teardown can stop them. Recorded verdicts reach the completion verifier and the PR creator (`readVerificationResults`).
- **Guidance** — agents run from the workspace root, so a repository's own CLAUDE.md, skills and agents never load for them. Guidance discovery (`pipelines/actions/discover-guidance.ts`, run alongside constraint discovery, best-effort) writes `artifacts/repo-guidance/<repo>.md` with `## Implementation` / `## Review` bullets of repo-relative paths, cached per clone in `.ai-workspace/repo-guidance/`. Planner and executor get the first section, the code and cross-repository reviewers the second, through `repoGuidanceSection` (`shared.ts`), which takes a skill's criteria and leaves its procedure unrun.

### PR watcher and repository lessons

- **PR watcher** (`src/lib/pr-watcher/`) — reads the PR on each worktree branch of every unarchived workspace (`readRepoPullRequest`, no LLM) and records changes against the last snapshot (`pr_watch`) as `pr_events`: new comments, pushes, CI flips, conflicts, merge / close. Which PRs a minute's tick reads is `scheduler.ts`: those a GitHub notification names (`/notifications?since=`, read or unread), those whose base branch moved (`git ls-remote`, no rate limit), those whose CI or mergeability was unsettled at the last read (backoff 1 → 2 → 4 → 8 min), and everything every `watcher.intervalMinutes` (sweep). It only observes; the PR tab shows the timeline. A merged or closed PR is not read again.
- **Suggestions** (`pr-watcher/suggestions.ts`) — from the snapshots and events, the PR tab (and a dashboard notice) proposes: triage of people's comments and still-failing CI newer than the workspace's `pr_handled` time, once comments are 5 min quiet ("Select for triage" only fills the tab's selection for the existing Triage); `resolve-base-conflicts` for a conflicting PR; archive once every PR is merged. Nothing runs on its own; none while an operation runs on the workspace. Bot authors carry `[bot]` (`pr-threads.ts`), and the gh user's own comments are skipped.
- **Archive** (`workspace/archive.ts`, used by the route and MCP) — refuses while PRs are open unless `closeOpenPrs` is set, which closes them, deletes their branches and records `closed-by-archive` (not a reviewer's rejection); then starts `harvest-lessons`. That operation does not unarchive the workspace (`orchestrator.ts`).
- **Lessons** (`src/lib/lessons/`, `repo_lessons`) — `harvest-lessons` gathers per repository the PR's comments and outcome, commits made while no operation ran (people and aiw share a git identity), and review / known findings (recorded in `lesson_findings` so recurrence across workspaces is visible), and a `distill-lessons` child proposes new / reinforce / merge entries. `applyDistilledLessons` enforces dedup: rejected wording never returns, a repeat becomes evidence. Keyed by clone (`cloneKey`). Only approved lessons (Utilities → Repo Lessons) reach the planner, executor and reviewers via `repoLessonsSection`; `.ai-workspace/repo-lessons/<clone>.md` is rendered from them. `bun run harvest-lessons` backfills archived workspaces through the running server.

### Autonomous loop

`autonomous.ts`: init (README → `Analyze README clarity` gate) → cycles of Execute → Review → Gate, and while looping `Update TODO` → Execute → Review → Gate, up to `maxLoops` (default 3); `create-pr` on success.

- **Gate bar** — loop only for Critical / Must-Fix / Should-Fix findings, unmet actionable `(auto)` criteria, pending in-scope TODOs, or requested fixes the `verify-fixes` child reports unlanded. Suggestions, low-confidence findings, ledger (recurring) findings and `(manual)` criteria never loop. Hitting `maxLoops` with work left stops without a PR (`FINAL_CYCLE_STOP_PREFIX`).
- **Every cycle has one shape** with the full reviewer set; don't add reduced-review shortcuts.
- **Per-repo completion** — the gate's `unfinishedRepositories` narrows later cycles' per-repo work; it fails toward keeping repos open. PRs are created at the end.
- **Incremental review** — reviews diff against the previous review's `baseline.json` (`workspace/review-baseline.ts`, `getIncrementalChanges()`); constraint and README verification stay full-scope.

### Prompts

`src/lib/templates/prompts/` has one `build*Prompt()` per agent; shared fragments in `shared.ts` (`worktreeCdRules` vs `NO_CD_RULES`, `WRITTEN_DELIVERABLE_LENGTH`, `REPO_SEARCH_EFFICIENCY`, `SCOPE_DISCIPLINE`, `NO_WORKSPACE_REFERENCES`, `REVIEW_COVERAGE_POLICY`, `SEVERITY_CALIBRATION`, `RECURRING_FINDINGS_POLICY`, …). Compose from fragments rather than restating them; `shared.test.ts` enforces adoption. Style: positive examples over stacks of "Do NOT", mark example lists non-exhaustive, no "double-check your work".

### Chat and Slack

- **Chat** — `src/lib/chat-server/`; opening prompts in `templates/prompts/chat.ts` (variants `chat` / `review-chat` / `research-chat` / `task` / `discussion` / `start-prompt`, chosen by `buildChatOpening`; saved start prompts live in the `chat_start_prompts` table, edited at Utilities → Chat Start Prompts). The browser terminal owns the PTY size. Start options pass via `stashChatHandoff` (`@/lib/chat-handoff`), not the URL. Busy state: `isSessionBusy` (`activity.ts`).
- **Slack bot** — `src/lib/slack-server/`: `init <desc>` starts autonomous, `init --only` starts init, anything else is a read-only-by-default conversation whose write policy is prompt-only (`templates/prompts/slack-chat.ts`); keep that prompt precise. `ws <desc>` has a model pick repositories, quick-creates the workspace (`followUp: false`) and binds the thread to it (`slack_thread_workspaces`, no TTL); a bound thread's conversation runs in the workspace and may edit worktrees but not commit or publish (`slack-workspace-chat.ts`), read-only while an operation runs on it, and its `init` runs update-todo / autonomous on that workspace. `ws` and `init` report through one thread message edited in place — creating → workspace header over a working line → done / failed, with the result posted as a new message (`status-message.ts`); for `init` the notifier does the later edits from `slack_pending_notifications`. The chat page's *Continue Slack conversation* resumes the thread's CLI session (`chat-server/slack-thread.ts`); one side drives it at a time — a Slack turn marks `turn_started_at`, and a live chat on the thread (`/sessions`' `slackThread`) refuses the Slack turn.

### Directories

`src/lib/db/` SQLite · `src/lib/claude/` CLI · `src/lib/pipeline/` engine · `src/lib/pipelines/` operation definitions · `src/lib/workspace/` filesystem + git · `src/lib/parsers/` markdown/stream parsing · `src/lib/templates/prompts/` prompts · `src/lib/chat-server/` · `src/lib/slack-server/` · `src/lib/operation-store/` completed operations · `src/hooks/` SWR hooks · `src/components/{dashboard,workspace,operation,shared}/`.

## Development Rules

- **Never start, stop or restart the server** unless asked. A hot-reloading dev instance is normally running; find its port with `pgrep -fl "bin/start.ts"`.
- **Never `pkill -f`** anything this project may be running — every pattern also matches the live instance. Kill only pids you started. If you kill the instance, report it; don't try to restart it.
- **Never block the event loop in server code.** Use `runProcess` / `exec` / `execArgs` / `runGit`, `await Bun.sleep()`, `node:fs/promises`, `Bun.file`, `pathExists` / `globScan` (`@/lib/fs`). ESLint rejects sync APIs under `src/` except the cached init code listed in `eslint.config.ts`. When making a function async, make sure every caller awaits it (`await f(x).y` is `await (f(x).y)`).
- **Keep the tool generic.** This is a public, general-purpose repository: nothing in it may depend on or point to a specific company, business, product or codebase. That covers prompts, test fixtures, comments, docs and commit messages, and it includes org and repo names, identifiers and file paths, ticket keys, internal tool or stack descriptions, and business-domain vocabulary. An example taken from a real run is rewritten into a neutral one (`acme/widgets`, `github.com/org/repo`, users / orders, `PROJ-123`) before it lands; swapping only the org name is not enough.
- **TDD**: write a failing test first.
- **Before committing**: `bun run lint` and `bun run test` must pass.
- **Git**: run `git add`, `git commit`, `git push` as separate commands; no `$()` in git commands.

## Conventions

- Path alias `@/*` → `./src/*`; types in `src/types/`; tests in `src/__tests__/` mirroring `src/`.
- Mutable server state (DB, operations, config, chat sessions, locks) lives on `globalThis` to survive HMR.
- All API routes export `const dynamic = "force-dynamic"`.
- ESLint: unused vars prefixed `_`; `bin/**` not linted.

## Testing

Vitest + Testing Library, globals enabled. Only `src/__tests__/components/**` and `src/__tests__/hooks/**` get jsdom; everything else runs in node. Bound any loop a permissive `vi.fn()` mock could make endless (`mock.calls` grows without limit). Kill a runaway vitest worker by pid.

## Gotchas

- `getConfig()` is cached; tests reset with `_resetDb()` → `_resetConfig()` → `_resetWorkspaceRoot()`. The workspace root must be set before config/DB.
- Events reach the DB asynchronously; don't query them right after emitting.
- Running operations are in memory (`src/lib/pipeline/store.ts`), completed ones on disk; `/api/operations` merges both.
- `runSubPhases` ignores sub-phase `timeoutMs` / `effort`: under autonomous only the wrapping phase budget (`CYCLE_BUDGETS_MS`, `executeCycleBudgetMs()`) applies.
- Lint type-checks through `tsconfig.typecheck.json` after `next typegen` because `.next/dev` types go stale on route deletion.
- `bin/next-server.ts` prewarms every route after a dev start (`src/lib/dev/prewarm.ts`).
