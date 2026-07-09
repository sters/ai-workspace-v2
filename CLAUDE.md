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
bun --bun vitest run src/__tests__/lib/parsers/todo.test.ts  # Single test file (--bun is required for bun:sqlite)
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

Other notable `config.yml` sections: `hooks.{sessionStartGitContext,blockDangerousBash}` (auto-managed Claude Code hooks; see Architecture), `suggest.enabled` (default `true`; set `false` to disable the post-operation workspace-suggestion background job triggered from `triggerWorkspaceSuggestion`), `slack.{enabled,botToken,appToken,allowedUserIds,chatModel,chatEffort,chatHeartbeatMs,chatMaxTurnMs,chatProgressModel}` (Slack bot integration; `chatModel`/`chatEffort` tune the conversation feature; `chatHeartbeatMs` (default 60000 = 1 min) / `chatMaxTurnMs` (default 1080000 = 18 min) control interim-progress cadence and the per-turn hard cap; `chatProgressModel` (default `haiku`, `null` disables) is the cheap model that summarizes interim progress to one line; see Architecture).

**Env-var substitution in config.yml** — Any string value can contain `{ENV:VAR_NAME}` placeholders, which are replaced with `process.env.VAR_NAME` at config-load time (`src/lib/config/env-substitution.ts`). Names are uppercase ASCII / digits / underscores. Missing env vars become empty strings with a `console.warn`. This is independent of the hardcoded `AIW_*` env overrides above (which still take precedence over the file). Use it for secrets like Slack tokens.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript strict mode, Tailwind CSS 4, SWR for data fetching. Bun runtime.

### Key architectural patterns

- **SQLite persistence** — Per-workspace database in `{workspaceRoot}/.ai-workspace/db.sqlite` via `bun:sqlite`. DB singleton on `globalThis` (`src/lib/db/connection.ts`). Events are buffered in memory and flushed every 5000ms or 50 events (`src/lib/db/event-buffer.ts`).
- **Pipeline orchestration** — Operations are sequences of `PipelinePhase`s (single child, parallel group, or TypeScript function). Entry point: `startOperationPipeline()` in `src/lib/pipeline/orchestrator.ts`. Max 3 concurrent operations. Pipeline definitions per operation type in `src/lib/pipelines/`. Operations interrupted by a server shutdown are NOT resumed — on restart `failStaleOperations()` (`src/lib/pipeline/cleanup-stale.ts`) settles each stale "running" row as failed (or completed if all phases finished), since resuming re-runs side effects and revived operations that didn't need it. Function phases can dynamically add phases via `appendPhases()` — the execution loop re-evaluates `phases.length` each iteration. The `runSubPhases()` utility in `src/lib/pipelines/actions/run-sub-phases.ts` runs sub-pipeline phases within a function phase context, handling all three phase kinds uniformly.
- **Claude CLI execution** — `src/lib/claude/cli.ts` spawns `claude -p --output-format stream-json`. Handles `AskUserQuestion` via `--resume {session_id}`. Re-exported from `src/lib/claude/index.ts`.
- **SSE streaming** — Clients connect to `/api/events?operationId=` for real-time operation output. Replays existing events on connection.
- **Instrumentation split** — `src/instrumentation.ts` delegates to `src/instrumentation-node.ts` at runtime to avoid bundling Node.js-only imports (SQLite, stale-operation cleanup) into Edge Runtime.
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
- **Slack bot** — Optional Socket Mode bot for `app_mention` events: kick off `init` operations, hold free-form conversations (read-only by default; writes only when explicitly asked), and post completion notifications. See the **Slack bot** subsection below for the full breakdown.

### Slack bot

Optional Socket Mode bot in `bin/slack-server.ts` (started by `bin/start.ts` when `slack.enabled` + both tokens resolve non-empty). Handles `app_mention` events only; mentions from non-allowlisted user IDs (`slack.allowedUserIds`) are silently dropped. Implementation lives in `src/lib/slack-server/` — bare filenames below are relative to it; the `app_mention` handler + `handleConversation` are in `index.ts`.

- **Commands** — `init <desc>` POSTs `/api/operations/autonomous` (`startWith: "init"`, full loop); `init --only <desc>` POSTs `/api/operations/init` (single op, no chain). Both force `interactionLevel: "low"` (Slack is kick-off only; progress + AskUserQuestion follow-ups happen in the WebUI). Anything else (not `init`/`help`) is free-form **conversation** (`parseCommand` → `kind: "chat"`). On accept the bot posts "OK! I'll start your request!"; dispatch failures post "Sorry, failed to start: …".
- **Completion notification** (autonomous only) — when `init` (no `--only`) finishes, a 30 s poller (`notifier.ts`) posts PR URLs back to the thread. Mapping persisted in `slack_pending_notifications` (migration v7). It scans only the `Create PR` phase events (label hardcoded in `pipelines/autonomous.ts`), runs `extractPrUrls()` (`workspace/pr-url.ts`), and subtracts URLs already present in the input description. Posts `Done! Created PRs: …` or `Done! No PRs were created…`. Failed runs are dropped silently (row deleted, no message). `init --only` is not tracked.
- **Thread link** — a mention inside a thread gets the thread root's `chat.getPermalink` appended to the description via `mergeWithThreadLink()` (`thread-link.ts`, separator `--- Slack thread ---`). The thread body is deliberately NOT inlined (it drowns out the actual request); init/plan fetch the thread on demand. Empty description + permalink alone is accepted. `getPermalink` failure → logged, typed description used as-is.
- **Conversation** (`conversation.ts`) — `converse(threadKey, message)` runs `runClaude` in-process at the workspace root with `skipAskUserQuestion` and **no `allowedTools`/`addDirs`**, inheriting the host's ambient Claude permissions (Bash/git/gh/MCP work wherever the environment allows). The write policy is enforced **only** by the system prompt (`getSlackChatSystemPrompt()` in `templates/prompts/slack-chat.ts`, applied via `appendSystemPromptFile`), not at the tool layer: **read-only on the model's own initiative; writes allowed only when the user explicitly asks** (mainly external MCP actions like "create a Jira ticket", prefer MCP tools); **two hard limits forbidden even on request** — (1) git repository / codebase changes (`git add/commit/push/…`, `gh pr/issue create/…`, editing tracked files, installs, migrations → routed to WebUI/`init`) and (2) destructive/irreversible actions (`rm -rf`, force-push, `git reset --hard`, dropping tables). Keep that prompt precise. MCP resolves from the workspace-root `.mcp.json`/user scope (per-repo `.mcp.json` is not picked up). Prompt builder `buildSlackChatPrompt()` sends full instructions on the first turn, bare message on resume. Model/effort from `config.slack.chatModel`/`chatEffort` (defaults sonnet/medium).
- **Session continuity** — CLI `session_id` keyed on `thread_ts ?? ts` (TTL 2 h, cap 200) persisted in `slack_conversation_sessions` (migration v8, `db/slack-sessions.ts`), so follow-ups `--resume` the same session and survive a restart. `RunClaudeOptions.resumeSessionId` seeds the spawn; `ClaudeProcess.getSessionId()` exposes the captured id (logged by `runClaude` on capture with a `claude --resume` hint). A resumed turn that fails with no output / non-zero exit (stale session) → `converse()` drops the id and retries **once** fresh.
- **Interim progress + hard cap** — a long turn is NOT killed at a short timeout. `runTurn` keeps the process alive and every `chatHeartbeatMs` (default 1 min) takes a snapshot of the assistant's accumulated text (`ClaudeProcess.getAssistantText()` — text blocks only, no tool noise) and compresses it to a one-line status via `summarizeProgress()` (`progress-summary.ts`, a throwaway `runClaude` call using `chatProgressModel`, default haiku, 30 s timeout). That summary is handed to `onProgress`; `handleConversation` renders it via `formatProgress()` ("⏳ {summary}", 300-char safety cap; bare "⏳ Still working…" when the snapshot is empty, summarization is disabled via `chatProgressModel: null`, or the summarizer failed) by editing the "🤔 Thinking…" placeholder in place (a `finished` guard stops a late edit clobbering the final answer; only one summary is in flight at a time). Only at `chatMaxTurnMs` (default 18 min) is the turn killed + reported as timed out — the `session_id` is persisted so replying in the thread resumes the work. The stale-session retry fires on `reason === "error"` only, never on the hard-cap timeout.
- **Per-user memory** (`slack.memoryEnabled`, default `true`) — each user gets a persistent memory in a **separate** SQLite file `.ai-workspace/slack-memory.sqlite` (`ensureSlackMemoryDb()` in `memory-db.ts`, NOT part of `db.sqlite` migrations) so a stray query can't touch operational data. No TS read/write path: the conversation Claude operates the DB itself via the `sqlite3` CLI, guided by instructions `buildSlackChatPrompt` folds into the first turn (DB path, `memories(id, user_id, content, …)` schema, the user's id, scoped SELECT/INSERT examples). Scoped strictly by `user_id`. `getSlackChatSystemPrompt()` grants read/write on the `memories` table (writes ONLY to `memories`, ONLY on explicit user request); keep it precise. `userId` flows `mention.user` → `handleConversation` → `converse(..., { userId })`; missing `userId` or disabled memory omits the block.
- **Thread folding** — the *first* conversation mention inside an existing thread (`mention.thread_ts` set, `hasThreadSession()` false) triggers `fetchThreadTranscript()` (`thread-fetch.ts`) via `conversations.replies` (paginated, cap 50×200), folded into the first-turn prompt (excluding the triggering mention; fetched before the placeholder). Resume turns skip it. Needs the channel-type history scope (`channels:history`/`groups:history`/`im:history`/`mpim:history`); on failure the conversation proceeds without thread context.

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
