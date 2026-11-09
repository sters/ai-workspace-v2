/**
 * Zod schemas for runtime validation of external/untrusted data:
 * - Files read from disk (JSONL, .mcp.json, ~/.claude.json)
 * - WebSocket messages from clients
 * - localStorage data
 * - SSE stream events
 * - Claude CLI stream-json output fragments
 *
 * These are separate from schemas.ts (HTTP request body validation).
 */

import z from "zod";

// ---------------------------------------------------------------------------
// Operation store (JSONL files in .operations/)
// ---------------------------------------------------------------------------

/**
 * Loose operation schema — validates key fields without duplicating the full Operation type.
 * NOTE: `type` remains z.string() intentionally. This schema is used for JSONL migration
 * of potentially old data that may contain operation types that have since been renamed
 * or removed. Tightening to z.enum() would reject valid historical records.
 */
const operationLoose = z.object({
  id: z.string(),
  type: z.string(),
  workspace: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
}).passthrough();

export const storedHeaderSchema = z.object({
  _type: z.literal("header"),
  operation: operationLoose,
});

export const storedEventSchema = z.object({
  _type: z.literal("event"),
  type: z.enum(["output", "error", "complete", "status", "terminal"]),
  operationId: z.string(),
  data: z.string(),
  timestamp: z.string(),
}).passthrough();

// ---------------------------------------------------------------------------
// MCP server config (.mcp.json / ~/.claude.json)
// ---------------------------------------------------------------------------

const mcpStdioConfigSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
}).passthrough();

const mcpSseConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();

const mcpHttpConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const mcpServerConfigSchema = z.union([
  mcpSseConfigSchema,
  mcpHttpConfigSchema,
  mcpStdioConfigSchema, // last — its `type` is optional so it acts as fallback
]);

export const mcpFileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
}).passthrough();

export const claudeJsonProjectSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
}).passthrough();

// ---------------------------------------------------------------------------
// Claude CLI stream-json fragments (used in parsers/stream.ts and cli.ts)
// ---------------------------------------------------------------------------

export const askQuestionItemSchema = z.object({
  question: z.string(),
  options: z.array(z.object({
    label: z.string(),
    description: z.string(),
  }).passthrough()).optional().default([]),
  multiSelect: z.boolean().optional().default(false),
});

export const permissionDenialItemSchema = z.object({
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
});

export const modelUsageSchema = z.record(z.string(), z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
  cacheCreationInputTokens: z.number().default(0),
  costUSD: z.number().default(0),
}));

/**
 * The line Claude Code appends to a session transcript on exit. Its totals are
 * cumulative over the session, resumes included. Undocumented CLI internals.
 */
export const transcriptCostStateSchema = z.object({
  type: z.literal("cost-state"),
  totalCostUSD: z.number(),
  totalAPIDuration: z.number().default(0),
  modelUsage: modelUsageSchema.default({}),
});

/** The cost-bearing fields of a stream-json `result` event. */
export const resultUsageSchema = z.object({
  type: z.literal("result"),
  total_cost_usd: z.number(),
  duration_ms: z.number().optional(),
  num_turns: z.number().optional(),
  modelUsage: modelUsageSchema.optional(),
  /** Present when one process emits several results; `modelUsage` and `total_cost_usd` are then cumulative. */
  model_usage_since_last_result: modelUsageSchema.optional(),
});

/** The completion verifier's structured verdict (`COMPLETION_VERIFICATION_SCHEMA`). */
export const completionVerificationSchema = z.object({
  requirements: z.array(z.object({
    requirement: z.string(),
    kind: z.enum(["auto", "manual"]),
    status: z.enum(["SATISFIED", "PARTIAL", "UNSATISFIED", "PENDING-HUMAN"]),
    evidence: z.string(),
    notes: z.string().optional(),
  })),
  todoItems: z.array(z.object({
    item: z.string(),
    status: z.enum(["VERIFIED", "UNVERIFIED", "PARTIAL", "INCOMPLETE", "UNMARKED", "SKIPPED"]),
    evidence: z.string(),
  })),
  recommendations: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// WebSocket ClientMessage (chat-server.ts)
// ---------------------------------------------------------------------------

const wsStartSchema = z.object({
  type: z.literal("start"),
  workspaceId: z.string().min(1),
  initialPrompt: z.string().optional(),
  reviewTimestamp: z.string().optional(),
  researchChat: z.boolean().optional(),
  task: z.string().optional(),
  discussion: z.string().optional(),
  startPrompt: z.string().optional(),
  replaces: z.string().optional(),
  slackThread: z.string().min(1).optional(),
  cols: z.number().optional(),
  rows: z.number().optional(),
});

const wsInputSchema = z.object({
  type: z.literal("input"),
  data: z.string(),
});

const wsResizeSchema = z.object({
  type: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

const wsKillSchema = z.object({
  type: z.literal("kill"),
});

const wsResumeSchema = z.object({
  type: z.literal("resume"),
  sessionId: z.string().min(1),
  cols: z.number().optional(),
  rows: z.number().optional(),
});

/**
 * The chat server's `POST /sessions/start`: a session started with no browser
 * attached, which one resumes later. Only a task opening is offered there.
 */
export const sessionStartRequestSchema = z.object({
  workspaceId: z.string().min(1),
  task: z.string().optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  wsStartSchema,
  wsInputSchema,
  wsResizeSchema,
  wsKillSchema,
  wsResumeSchema,
]);

// ---------------------------------------------------------------------------
// Client-side: localStorage and SSE events
// ---------------------------------------------------------------------------

export const operationListItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  workspace: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  currentPhase: z.object({
    index: z.number(),
    label: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
    timeoutMs: z.number().optional(),
    startedAt: z.string().optional(),
  }).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  resultSummary: z.object({
    content: z.string(),
    cost: z.string().optional(),
    duration: z.string().optional(),
    results: z.array(z.object({
      label: z.string().optional(),
      content: z.string(),
      cost: z.string().optional(),
      duration: z.string().optional(),
    })).optional(),
  }).optional(),
  hasPendingAsk: z.boolean().optional(),
  usageLimitWaitUntil: z.string().optional(),
}).passthrough();

export const operationEventSchema = z.object({
  type: z.enum(["output", "error", "complete", "status", "terminal"]),
  operationId: z.string(),
  data: z.string(),
  timestamp: z.string(),
  childLabel: z.string().optional(),
  phaseIndex: z.number().optional(),
  phaseLabel: z.string().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Verification scenarios (artifacts/verification/<id>.json, planner output)
// ---------------------------------------------------------------------------

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A step before it runs, as the planner or the Verify tab's editor writes it. */
export const verificationStepDraftSchema = z.object({
  title: z.string().min(1),
  actor: z.enum(["claude", "human"]),
  repo: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  background: z.boolean().optional(),
  readyCommand: z.string().min(1).optional(),
  outputs: z.array(z.string().regex(VARIABLE_NAME)).optional(),
  instructions: z.string().min(1).optional(),
  inputs: z.array(z.object({
    name: z.string().regex(VARIABLE_NAME),
    label: z.string().min(1),
    options: z.array(z.string().min(1)).min(1).optional(),
  })).optional(),
  expected: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  teardown: z.boolean().optional(),
}).superRefine((s, ctx) => {
  if (s.actor === "claude" && !s.command) {
    ctx.addIssue({ code: "custom", message: `Claude step "${s.title}" needs a command` });
  }
  if (s.actor === "human" && !s.instructions) {
    ctx.addIssue({ code: "custom", message: `Human step "${s.title}" needs instructions` });
  }
  if (s.actor === "human" && s.teardown) {
    ctx.addIssue({ code: "custom", message: `Teardown step "${s.title}" must be a Claude step` });
  }
});

export const verificationPlanSchema = z.object({
  scenarios: z.array(z.object({
    title: z.string().min(1),
    summary: z.string(),
    steps: z.array(verificationStepDraftSchema).min(1),
  })),
});

const verificationStepSchema = z.intersection(verificationStepDraftSchema, z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "waiting", "passed", "failed", "skipped"]),
  revision: z.number(),
  result: z.object({
    at: z.string(),
    exitCode: z.number().nullable().optional(),
    output: z.string().optional(),
    durationMs: z.number().optional(),
    note: z.string().optional(),
    values: z.record(z.string(), z.string()).optional(),
  }).optional(),
}));

export const verificationScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.enum(["ready", "running", "waiting", "failed", "passed", "aborted"]),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  variables: z.record(z.string(), z.string()),
  steps: z.array(verificationStepSchema),
  processes: z.array(z.object({
    stepId: z.string(),
    pid: z.number(),
    command: z.string(),
    logFile: z.string(),
    startedAt: z.string(),
  })),
});
