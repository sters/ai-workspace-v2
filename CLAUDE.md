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
```

## Configuration

`{workspaceRoot}/.ai-workspace/config.yml`; priority env > config.yml > defaults (`src/lib/config/resolver.ts`, cached on `globalThis`). Workspace root: CLI arg > `AIW_WORKSPACE_ROOT` > cwd. Env vars: `AIW_WORKSPACE_ROOT`, `AIW_PORT` (3741), `AIW_CHAT_PORT` (3742), `AIW_CLAUDE_PATH`, `AIW_DISABLE_ACCESS_LOG`. String values may use `{ENV:VAR_NAME}` (`env-substitution.ts`).

Notable keys: `operations.maxGroupConcurrency` (per parallel group, `getMaxGroupConcurrency()`), `operations.batchSize` (TODO groups per executor call), `operations.defaultInteractionLevel`, `model` / `effort` (global, per operation, per step), `bestOfN`, `openers`, `hooks.*`, `suggest.enabled`, `slack.*`. When changing per-step defaults, update `TYPE_OVERRIDE_HINT_LINES` (`src/lib/config/migration.ts`).

## Architecture

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, SWR, Bun runtime.

- **Processes** — `bin/start.ts` spawns Next.js (`bin/next-server.ts`), the chat server (`bin/chat-server.ts`) and optionally the Slack bot (`bin/slack-server.ts`). `--hot` applies to all three; each registers process-level state (signal handlers, timers, Slack connection) once, guarded on `globalThis`.
- **SQLite** — `.ai-workspace/db.sqlite` via `bun:sqlite` (`src/lib/db/`). Events are buffered and flushed asynchronously (`event-buffer.ts`).
- **Pipelines** — an operation is a list of `PipelinePhase`s (single child, parallel group, or TS function) run by `startOperationPipeline()` (`src/lib/pipeline/orchestrator.ts`; max 3 concurrent). Definitions in `src/lib/pipelines/` (`build*Pipeline()`), reusable pieces in `pipelines/actions/`. Function phases get a `PhaseFunctionContext` (`emitStatus` / `emitResult` / `emitAsk` / `runChild` / `runChildGroup` / `appendPhases` / `setWorkspace` / `signal`). Phases have `maxRetries` (default 2) and `timeoutMs`. Interrupted operations are settled as failed on restart (`failStaleOperations()`), never resumed. Phase state travels as `__phaseUpdate:` / `__setWorkspace:` status events.
- **Claude CLI** — `src/lib/claude/cli.ts`. `allowedTools` replaces the patterns `addDirs` would generate (used to make agents read-only).
- **Model / effort** — `resolveModel()` / `resolveEffort()` (`src/lib/config/model.ts`): explicit > config (per-op per-step > per-op > global) > `STEP_DEFAULT_MODELS` / `STEP_DEFAULT_EFFORTS` > CLI default. Defaults form four rungs — sonnet/low, opus/low, opus/medium (default), opus/high — enforced by `effort.test.ts` / `model.test.ts` (both tables cover the same steps; sonnet ⇒ low). A new step goes on an existing rung, chosen by how open-ended its work is.
- **Validation** — Zod: `src/lib/schemas.ts` (HTTP bodies) and `src/lib/runtime-schemas.ts` (untrusted runtime data), kept separate.
- **Managed hooks** — `src/lib/claude/hooks/sync.ts` writes `aiw-`-prefixed hooks into `.claude/settings.local.json` on startup (git context on SessionStart; blocks `rm -rf /`, force push, `git reset --hard`). Non-`aiw-` hooks are preserved.

### Workspace model

- **README done-contract** (`src/lib/templates/readme.ts`) — `## Goal`, `## Non-Goal`, `## Assumptions`, `## Requirements`, `## Acceptance Criteria` (checkboxes tagged `(auto)` / `(manual)`, parsed by `parseAcceptanceCriteria()`). Verifiers and the autonomous gate treat it as authoritative, so prompts that write it must ground it in the request and never fabricate.
- **TODO files** — `TODO-<repo>.md` per worktree with `[ ]` / `[~]` / `[x]` / `[!]` (`src/lib/parsers/todo.ts`).
- **Artifacts** — `artifacts/` holds reviews (`reviews/<ts>/`, incl. `baseline.json`), `known-findings.md` (findings deliberately not acted on, read by reviewers and the gate), `pr-validations.json`, `finding-groundings.json`, `memo.md`.
- **Repository setup** — `setupRepository` / `setupRepositories` (`pipelines/actions/setup-repository.ts`). `repo:alias` gives another worktree of one clone. `setupRepositories` fetches each clone once and checks out worktrees in parallel, with branch creation serialized per clone (`withCloneLock`: concurrent `worktree add -b` fail on the `.git/config` lock). A failed fetch proceeds on local refs; a failed clone is fatal.
- **Constraints** — `## Repository Constraints` in the README is written by constraint discovery (probes each tool, never runs lint/test/build; cached per clone in `.ai-workspace/repo-constraints/`, bump `FINGERPRINT_VERSION` when key rules change) and executed only by review's `Verify constraints` phase.

### Autonomous loop

`autonomous.ts`: init (README → `Analyze README clarity` gate) → cycles of Execute → Review → Gate, and while looping `Update TODO` → Execute → Review → Gate, up to `maxLoops` (default 3); `create-pr` on success.

- **Gate bar** — loop only for Critical / Must-Fix / Should-Fix findings, unmet actionable `(auto)` criteria, pending in-scope TODOs, or requested fixes the `verify-fixes` child reports unlanded. Suggestions, low-confidence findings, ledger (recurring) findings and `(manual)` criteria never loop. Hitting `maxLoops` with work left stops without a PR (`FINAL_CYCLE_STOP_PREFIX`).
- **Every cycle has one shape** with the full reviewer set; don't add reduced-review shortcuts.
- **Per-repo completion** — the gate's `unfinishedRepositories` narrows later cycles' per-repo work; it fails toward keeping repos open. PRs are created at the end.
- **Incremental review** — reviews diff against the previous review's `baseline.json` (`workspace/review-baseline.ts`, `getIncrementalChanges()`); constraint and README verification stay full-scope.

### Prompts

`src/lib/templates/prompts/` has one `build*Prompt()` per agent; shared fragments in `shared.ts` (`worktreeCdRules` vs `NO_CD_RULES`, `WRITTEN_DELIVERABLE_LENGTH`, `REPO_SEARCH_EFFICIENCY`, `SCOPE_DISCIPLINE`, `NO_WORKSPACE_REFERENCES`, `REVIEW_COVERAGE_POLICY`, `SEVERITY_CALIBRATION`, `RECURRING_FINDINGS_POLICY`, …). Compose from fragments rather than restating them; `shared.test.ts` enforces adoption. Style: positive examples over stacks of "Do NOT", mark example lists non-exhaustive, no "double-check your work".

### Chat and Slack

- **Chat** — `src/lib/chat-server/`; opening prompts in `templates/prompts/chat.ts` (variants `chat` / `review-chat` / `research-chat` / `task` / `discussion`, chosen by `buildChatOpening`). The browser terminal owns the PTY size. Start options pass via `stashChatHandoff` (`@/lib/chat-handoff`), not the URL. Busy state: `isSessionBusy` (`activity.ts`).
- **Slack bot** — `src/lib/slack-server/`: `init <desc>` starts autonomous, `init --only` starts init, anything else is a read-only-by-default conversation whose write policy is prompt-only (`templates/prompts/slack-chat.ts`); keep that prompt precise.

### Directories

`src/lib/db/` SQLite · `src/lib/claude/` CLI · `src/lib/pipeline/` engine · `src/lib/pipelines/` operation definitions · `src/lib/workspace/` filesystem + git · `src/lib/parsers/` markdown/stream parsing · `src/lib/templates/prompts/` prompts · `src/lib/chat-server/` · `src/lib/slack-server/` · `src/lib/operation-store/` completed operations · `src/hooks/` SWR hooks · `src/components/{dashboard,workspace,operation,shared}/`.

## Development Rules

- **Never start, stop or restart the server** unless asked. A hot-reloading dev instance is normally running; find its port with `pgrep -fl "bin/start.ts"`.
- **Never `pkill -f`** anything this project may be running — every pattern also matches the live instance. Kill only pids you started. If you kill the instance, report it; don't try to restart it.
- **Never block the event loop in server code.** Use `runProcess` / `exec` / `execArgs` / `runGit`, `await Bun.sleep()`, `node:fs/promises`, `Bun.file`, `pathExists` / `globScan` (`@/lib/fs`). ESLint rejects sync APIs under `src/` except the cached init code listed in `eslint.config.ts`. When making a function async, make sure every caller awaits it (`await f(x).y` is `await (f(x).y)`).
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
