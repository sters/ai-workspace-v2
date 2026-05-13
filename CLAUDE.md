# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Web UI dashboard for a multi-repository workspace manager for Claude Code. Browser interface on `localhost:3741` to view workspace status, TODO progress, reviews, git history, and trigger operations (init, execute, review, create-pr, autonomous, etc.) that run Claude Code via `Bun.spawn` + `claude -p --output-format stream-json`. WebSocket chat server on port 3742 for interactive Claude sessions.

## Commands

```bash
bunx github:sters/ai-workspace-v2 [/path/to/ai-workspace]  # Run via bunx
bun install                                                  # Install dependencies
bun run dev:hot                                              # Development with hot reload
bun run build && bun run start                               # Production build + start
bun run lint                    # Runs both tsc --noEmit AND eslint src/
bun run test                    # Run all tests
bun run test:watch              # Run tests in watch mode
bunx vitest run src/__tests__/lib/parsers/todo.test.ts  # Single test file
```

## Configuration

Per-workspace config stored in `{workspaceRoot}/.ai-workspace/config.yml`. Three-tier priority: env vars > config.yml > defaults. Config resolution in `src/lib/config/resolver.ts`, cached on `globalThis`. Workspace root is resolved first (CLI arg > `AIW_WORKSPACE_ROOT` env > cwd), then the config directory is derived from it. Directory layout in `src/lib/config/workspace-dir.ts`.

| Variable | Default | Description |
|----------|---------|-------------|
| `AIW_WORKSPACE_ROOT` | cwd | ai-workspace root (must contain `workspace/` and `repositories/`) |
| `AIW_PORT` | 3741 | Next.js server port |
| `AIW_CHAT_PORT` | 3742 | WebSocket chat server port |
| `AIW_CLAUDE_PATH` | auto-detect | Custom Claude CLI path |
| `AIW_DISABLE_ACCESS_LOG` | `false` | Silence Next.js dev access logs (also `server.disableAccessLog` in config.yml) |

The "Open in..." dropdown is configured via the `openers: { name, command }[]` field in `config.yml`. Defaults to one VSCode and one Terminal entry. Legacy `editor`/`terminal` top-level keys are auto-migrated to `openers` at runtime in `normalizeRawConfig` (`src/lib/config/resolver.ts`).

Other notable `config.yml` sections: `hooks.{sessionStartGitContext,blockDangerousBash}` (auto-managed Claude Code hooks; see Architecture), `suggest.enabled` (default `true`; set `false` to disable the post-operation workspace-suggestion background job triggered from `triggerWorkspaceSuggestion`), `slack.{enabled,botToken,appToken,allowedUserIds}` (Slack bot integration; see Architecture).

**Env-var substitution in config.yml** — Any string value can contain `{ENV:VAR_NAME}` placeholders, which are replaced with `process.env.VAR_NAME` at config-load time (`src/lib/config/env-substitution.ts`). Names are uppercase ASCII / digits / underscores. Missing env vars become empty strings with a `console.warn`. This is independent of the hardcoded `AIW_*` env overrides above (which still take precedence over the file). Use it for secrets like Slack tokens.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 4, SWR for data fetching. Bun runtime.

### Key architectural patterns

- **SQLite persistence** — Per-workspace database in `{workspaceRoot}/.ai-workspace/db.sqlite` via `bun:sqlite`. DB singleton on `globalThis` (`src/lib/db/connection.ts`). Events are buffered in memory and flushed every 5000ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Pipeline orchestration** — Operations are sequences of `PipelinePhase`s (single child, parallel group, or TypeScript function). Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Max 3 concurrent operations. Pipeline definitions per operation type in `src/lib/pipelines/`. Recovers interrupted operations on restart (`src/lib/pipeline/resume.ts`). Function phases can dynamically add phases via `appendPhases()` — the execution loop re-evaluates `phases.length` each iteration. The `runSubPhases()` utility in `src/lib/pipelines/actions/run-sub-phases.ts` runs sub-pipeline phases within a function phase context, handling all three phase kinds uniformly.
- **Claude CLI execution** — `src/lib/claude/cli.ts` spawns `claude -p --output-format stream-json`. Handles `AskUserQuestion` via `--resume {session_id}`. Re-exported from `src/lib/claude/index.ts`.
- **SSE streaming** — Clients connect to `/api/events?operationId=` for real-time operation output. Replays existing events on connection.
- **Instrumentation split** — `src/instrumentation.ts` delegates to `src/instrumentation-node.ts` at runtime to avoid bundling Node.js-only imports (SQLite, pipeline resume) into Edge Runtime.
- **Two-server setup** — `bin/start.ts` spawns Next.js (`bin/next-server.ts`) and the WebSocket chat (`bin/chat-server.ts`) as separate processes; the Slack bot (`bin/slack-server.ts`) is spawned as an optional third process when `slack.enabled` + tokens are present.
- **Zod validation** — `src/lib/schemas.ts` for HTTP request bodies, `src/lib/runtime-schemas.ts` for untrusted runtime data (JSONL, WebSocket messages, SSE events, CLI stream fragments). Intentionally separate files.
- **Best-of-N pattern** — Operations like review, execute, create-pr, update-todo support parallel "candidate" runs. `buildBestOfNPipeline()` in `src/lib/pipelines/best-of-n.ts` runs N candidates, then a synthesizer phase reviews all results. Controlled by `bestOfN` in config (per-operation-type overrides supported).
- **Batch & autonomous chaining** — Batch pipelines chain operation types (init → execute → review → create-pr) with configurable gating. Autonomous mode loops execute → review → create-pr up to `maxLoops` times with autonomous gate logic. Both use `startWith` to indicate the first phase.
- **Phase update markers** — Phase lifecycle is communicated via special JSON prefixes in status events: `"__phaseUpdate:"` and `"__setWorkspace:"`. These are parsed by `parsePhaseUpdatesFromEvents()` / `parsePhaseUpdatesFromEntries()` to rebuild phase arrays from the event stream without needing a separate phases table.
- **Function phase context** — TypeScript function phases receive a `PhaseFunctionContext` with `emitStatus()`, `emitResult()`, `emitAsk()` (blocks until user answers), `runChild()` / `runChildGroup()` (spawn Claude sub-processes), `emitTerminal()` (raw PTY output), `appendPhases()` (dynamic phase injection), `setWorkspace()`, and `signal` (AbortSignal for kills). Child processes accept `allowedTools` (explicit tool restrictions — overrides auto-generated patterns from `addDirs`), `appendSystemPromptFile` (appended to Claude's system prompt), `stepType` (for config-based model resolution), and `skipAskUserQuestion`.
- **Model resolution** — 6-tier priority in `src/lib/config/model.ts`: explicit model > per-operation per-step config > per-operation config > global operations model > code-level `STEP_DEFAULT_MODELS` > CLI default. Step types like `code-review`, `autonomous-gate` default to sonnet; `verify-todo`, `collect-reviews` default to haiku.
- **Phase retries** — Phases support `maxRetries` (default 2) and `retryDelayMs` (default 3000). Per-phase timeouts use separate AbortControllers from the operation-level kill signal.
- **Workspace archiving** — `workspace_archives` table (migration v4). `POST /api/workspaces/[name]/archive` toggles archive. Dashboard filters via `recentOnly` (skips workspaces older than 1 week) and `includeArchived` query params.
- **TODO normalization** — `normalizeTodoCheckboxes()` fixes common LLM formatting errors (missing checkboxes, bracket spacing, asterisk bullets). `stripCompletedTodoItems()` removes `[x]` items before update-todo runs. Both prevent autonomous loops.
- **Memo tab** — Per-workspace `artifacts/memo.md` file with Monaco editor (`src/components/workspace/memo-editor.tsx`). Auto-saves every 60s + on navigation/beforeunload. Module-level content cache prevents stale content on tab switches. Toolbar actions on selected text: "Update TODO" (starts update-todo operation) and "Ask Claude" (inline streamed response via quick-ask). API: `GET/POST /api/workspaces/[name]/memo`.
- **Quick Ask** — Lightweight Claude queries for inline features (memo "Ask Claude", etc.). Configurable in `config.yml` under `quickAsk`: `model` (default sonnet), `effort` (default medium; low/medium/high/max, null = CLI default), `allowedTools` (default read-only tools: Read, Glob, Grep, WebFetch, WebSearch; set to `null` for no restriction). API: `POST /api/operations/quick-ask`.
- **Auto-managed Claude Code hooks** — `src/lib/claude/hooks/sync.ts` writes hook entries into `.claude/settings.local.json` and `.claude/hooks/aiw-*.sh` scripts on every startup (called from `src/instrumentation-node.ts`). Managed entries are identified by the `aiw-` command prefix; user-authored hooks without that prefix are preserved verbatim. Two hooks ship today: `SessionStart` (injects `git branch` + `git status --short` as additionalContext) and `PreToolUse(Bash)` (blocks `rm -rf /...`, `git push --force` without `--force-with-lease`, `git reset --hard`). Toggleable per-workspace via `hooks.sessionStartGitContext` / `hooks.blockDangerousBash` in `config.yml` (both default `true`).
- **Function phase output grouping** — `emitStatus`/`emitResult`/`emitTerminal`/`emitAsk`/`setWorkspace` from a function phase are auto-tagged with `childLabel = phaseLabel` so they render as boxed sections in the operation log alongside Claude child output. `runChild`/`runChildGroup` preserve `phaseExtra` so each child still gets its own label via `wireChild` (`src/lib/pipeline/context-builder.ts`).
- **Slack bot** — Optional Socket Mode bot in `bin/slack-server.ts` (started by `bin/start.ts` when `slack.enabled` and both tokens resolve non-empty). Listens for `app_mention` events; mentions from non-allowlisted Slack user IDs (`slack.allowedUserIds`) are silently dropped. The only command exposed is `init`: `init <description>` POSTs to `/api/operations/autonomous` with `startWith: "init"` (full autonomous loop), and `init --only <description>` POSTs to `/api/operations/init` (single init operation, no chain). Both force `interactionLevel: "low"` since Slack is kick-off only — progress and any AskUserQuestion follow-ups are handled in the WebUI. On accept, the bot posts "OK! I'll proceed this soon!" once in the mention thread; dispatch failures post "Sorry, failed to start: …". **Completion notification (autonomous only)**: when `init` (without `--only`) finishes, a polling notifier (`src/lib/slack-server/notifier.ts`, 30 s interval) posts back to the original thread. The mapping is persisted in the `slack_pending_notifications` SQLite table (migration v7) so it survives slack-server restarts. The notifier scans the operation's events, runs `extractPrUrls()` (`src/lib/workspace/pr-url.ts`) over the concatenated event data, and replies with either `Done! Created PRs: • <url> …` or `Done! No PRs were created. Please check details on WebUI.`. Failed runs are silently dropped (the row is deleted but no message posted) — users check the WebUI for details. `init --only` is not tracked since it never produces PRs. **Thread context**: when the mention is posted inside an existing thread, the bot fetches `conversations.replies` and folds the prior messages into the description via `src/lib/slack-server/thread-context.ts`. Excluded: the mention itself, and the bot's own prior replies (matched against `auth.test()` `user_id` / `bot_id` resolved at startup). Other bots/apps (GitHub, CI, alerts, etc.) ARE included; messages without a `user` are labeled by `bot_profile.name` or `username`. Empty descriptions are accepted in that case — the thread becomes the description. Required additional Slack Bot Token scopes for thread reading: `channels:history` (public), `groups:history` (private), `im:history` / `mpim:history` (DMs). Missing scopes log a warning and the operation proceeds with only the typed description. Parser is `src/lib/slack-server/commands.ts`; HTTP layer is `src/lib/slack-server/dispatcher.ts`.

### Server-side key directories

- `src/lib/db/` — SQLite CRUD and migrations
- `src/lib/claude/` — Claude CLI execution, auth, settings
- `src/lib/pipeline/` — Pipeline orchestration engine
- `src/lib/pipelines/` — Pipeline definitions per operation type (each exports `build*Pipeline()`)
- `src/lib/workspace/` — Filesystem operations (reading workspace state, git ops, setup)
- `src/lib/parsers/` — Markdown parsing (TODO: `[x]`/`[ ]`/`[!]`/`[~]` syntax, README, reviews, stream-json)
- `src/lib/templates/prompts/` — `build*Prompt()` functions for each agent type
- `src/lib/chat-server/` — WebSocket session management with message buffering
- `src/lib/operation-store/` — Reads completed operations from disk (JSONL/JSON files)
- `src/lib/web-push/` — Browser push notification subscriptions for operation completion
- `src/lib/config/model.ts` — 6-tier model resolution logic
- `src/lib/pipelines/actions/` — Reusable pipeline building blocks (`run-sub-phases.ts`, TODO stripping/normalization)

### Client-side

- `src/hooks/` — SWR hooks with auto-refresh, operation lifecycle with localStorage persistence, SSE streaming
- `src/components/` — `dashboard/`, `workspace/`, `operation/`, `shared/`

## Development Rules

- **TDD**: Write or update tests before implementing production code. First write a failing test, then implement.
- **Pre-commit checks**: Always run `bun run lint` and `bun run test` before committing. Both must pass with zero errors.
- **Git commands**: Run `git add`, `git commit`, and `git push` as separate commands — never chain them. Do not use `$()` substitution in git commands.

## Conventions

- Path alias: `@/*` → `./src/*`
- **`globalThis` pattern**: Mutable state (DB connection, pipeline operations, app config, chat sessions) stored on `globalThis` to survive Next.js HMR. Tests must account for this (see `test-setup.ts`).
- **`force-dynamic`**: All API routes export `const dynamic = "force-dynamic"`.
- ESLint flat config (`eslint.config.ts`): unused vars must be prefixed with `_`. `bin/**` is excluded from linting.
- `bun:sqlite` is in `serverExternalPackages` in `next.config.ts`.
- Types in `src/types/`, test files in `src/__tests__/` mirroring `src/` structure.

## Testing

Vitest with jsdom, `@testing-library/react`, `@testing-library/jest-dom`. Globals enabled (no need to import `describe`/`it`/`expect`). `tsconfig.json` excludes test files — Vitest handles type-checking separately from `tsc --noEmit`.

## Gotchas

- **Config is cached on first access** — `getConfig()` stores on globalThis. Changes to `config.yml` require `_resetConfig()` to take effect. Tests must call reset functions in order: `_resetDb()` → `_resetConfig()` → `_resetWorkspaceRoot()`.
- **Event buffering is async** — Events aren't persisted immediately (500ms flush interval). Don't query events from the DB immediately after emitting them. SSE streaming replays from the in-memory buffer so clients see events before flush.
- **Workspace root must be set before config/DB** — The entire config directory and DB path depend on workspace root being known first. `bin/start.ts` calls `setWorkspaceRoot()` before `getConfig()`.
- **Function phase timeouts use separate AbortControllers** — Per-phase timeouts don't permanently abort the shared `managed.abortController` (which is for user-initiated kills). This is intentional to prevent timeout from killing the whole operation.
- **Running vs completed operations live in different stores** — Running operations are in-memory (`src/lib/pipeline/store.ts`). Completed ones are on disk. `/api/operations` merges both, with running taking precedence on dedup. The same route also serves `?status=completed&limit=N` (backed by `listRecentFinishedOperations`) for the "Recent Operations" panel on `/utilities/running`.
- **Constraint phases stop on first timeout** — In `review.ts`, constraint commands run sequentially and skip the rest after any timeout, since they're deterministic and later ones often depend on earlier artifacts. Stacking 5-min timeouts otherwise pushes the parent autonomous Cycle Review past its 15-min budget.
- **JSONL auto-migration** — On first startup, `getDb()` triggers `migrateJsonlToSqlite()` which imports legacy `.operations/` JSONL files if the SQLite table is empty.
- **Dev mode clears `.next` cache** — `bin/next-server.ts` removes `.next` on dev/hot startup to avoid stale route issues.
