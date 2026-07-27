import type { ClaudeEffort, ClaudeModel } from "./claude";
import type { OperationType } from "./operation";
import type { InteractionLevel } from "./prompts";

/** Per-step settings within an operation type override. */
export interface StepSettings {
  model?: ClaudeModel;
  effort?: ClaudeEffort;
}

/** Settings that can be overridden per operation type. */
export interface OperationTypeSettings {
  claudeTimeoutMinutes: number;
  functionTimeoutMinutes: number;
  defaultInteractionLevel: InteractionLevel;
  /** Best-of-N parallel execution count. 0 = disabled, 2-5 = parallel count. */
  bestOfN: number;
  /** Number of TODO groups to process per batch in execute operations. */
  batchSize: number;
  /** Default Claude model for this operation type. */
  model?: ClaudeModel;
  /** Default Claude CLI --effort level for this operation type. */
  effort?: ClaudeEffort;
  /** Per-step model / effort overrides within this operation type. */
  steps?: Record<string, StepSettings>;
}

export interface AppConfig {
  workspaceRoot: string | null;

  server: {
    port: number;
    chatPort: number;
    /** Disable Next.js dev-mode incoming-request access logs. */
    disableAccessLog: boolean;
  };

  claude: {
    path: string | null;
  };

  operations: OperationTypeSettings & {
    maxConcurrent: number;
    /** Per-operation-type setting overrides. Keys are OperationType values. */
    typeOverrides: Partial<Record<OperationType, Partial<OperationTypeSettings>>>;
  };

  /** Settings for the interactive WebSocket chat sessions. */
  chat: {
    /** Default Claude model. null = CLI default. */
    model: ClaudeModel | null;
  };

  /** External tools that can open a workspace path (editor, terminal, etc.). */
  openers: Opener[];

  /** Background workspace-suggestion feature (incidental observations from operation transcripts). */
  suggest: {
    /** When false, no suggestions are generated after operations complete. */
    enabled: boolean;
  };

  /** Auto-managed Claude Code hooks written into .claude/settings.local.json. */
  hooks: {
    /** Inject `git branch` + `git status --short` as SessionStart additionalContext. */
    sessionStartGitContext: boolean;
    /** Block `rm -rf /...`, `git push --force` (without --force-with-lease), `git reset --hard`. */
    blockDangerousBash: boolean;
  };

  /**
   * Slack bot integration. When enabled, a separate Bun process opens a Socket
   * Mode connection and accepts mention commands (`init`, `execute`, `review`,
   * `create-pr`, `autonomous`). Token strings support `{ENV:VAR_NAME}`
   * substitution at config load time.
   */
  slack: {
    /** Master switch. When false, the slack-server process is not spawned. */
    enabled: boolean;
    /** Bot User OAuth Token (`xoxb-...`). */
    botToken: string;
    /** App-Level Token (`xapp-...`) used to open the Socket Mode connection. */
    appToken: string;
    /**
     * Slack user IDs (e.g. `U01234ABC`) allowed to invoke commands.
     * Empty array = no one is allowed (fail closed). Mentions from
     * non-allowed users are silently ignored.
     */
    allowedUserIds: string[];
    /**
     * Model for the read-only conversation (mentions that aren't `init`/`help`).
     * null = CLI default. The tool set is always read-only and not configurable.
     */
    chatModel: ClaudeModel | null;
    /** Claude CLI --effort level for the read-only conversation. null = CLI default. */
    chatEffort: ClaudeEffort | null;
    /**
     * Interval (ms) at which a still-running conversation turn posts an interim
     * progress snapshot back to the Slack thread. Default 60000 (1 min).
     */
    chatHeartbeatMs: number;
    /**
     * Hard cap (ms) on a single conversation turn. When exceeded the turn is
     * killed and reported as timed out (the CLI session is persisted so the
     * thread can resume). Default 1080000 (18 min).
     */
    chatMaxTurnMs: number;
    /**
     * Model used to compress an interim progress snapshot into a one-line
     * status before posting it to the thread. Default "haiku" (cheap). null
     * disables summarization — heartbeats then post only a bare "still working"
     * marker instead of any assistant text.
     */
    chatProgressModel: ClaudeModel | null;
    /**
     * When true, the read-only conversation is given a per-Slack-user memory
     * database (`.ai-workspace/slack-memory.sqlite`) it can read/write via the
     * `sqlite3` CLI to recall/persist facts across threads. Default true.
     */
    memoryEnabled: boolean;
  };
}

/**
 * A user-defined external tool (editor, terminal, browser, ...) that can be
 * launched to open a workspace or repository path.
 *
 * Names must be unique across `openers`. The `command` must contain the
 * `{path}` placeholder which is replaced with the target absolute path.
 */
export interface Opener {
  /** Unique display name. Shown in the "Open in..." menu. */
  name: string;
  /** Shell command. `{path}` is replaced with the target path. */
  command: string;
}
