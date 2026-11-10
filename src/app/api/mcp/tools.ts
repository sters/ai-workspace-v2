import z from "zod";
import type { McpTool } from "@/lib/mcp/protocol";
import type { OperationEvent, OperationListItem } from "@/types/operation";
import { resolveWorkspaceName } from "@/lib/config";
import { unarchiveWorkspace } from "@/lib/db/archives";
import { archiveWorkspaceWithPrs, OpenPullRequestsError } from "@/lib/workspace/archive";
import { getOperation, getOperationEvents, getOperationSummaries } from "@/lib/pipeline-manager";
import { readOperationLog } from "@/lib/operation-store";
import { eventsToLogEntries, extractResultSummary } from "@/lib/parsers/stream";
import { findPendingAsk } from "@/components/operation/log/display-nodes";
import { getWorkspaceSummary, listWorkspaceItems } from "@/lib/workspace/reader";
import {
  autonomousSchema,
  createPrSchema,
  executeSchema,
  harvestLessonsSchema,
  initSchema,
  operationAnswerSchema,
  operationKillSchema,
  reviewSchema,
  updateTodoSchema,
} from "@/lib/schemas";
import { POST as postInit } from "../operations/init/route";
import { POST as postAutonomous } from "../operations/autonomous/route";
import { POST as postExecute } from "../operations/execute/route";
import { POST as postReview } from "../operations/review/route";
import { POST as postCreatePr } from "../operations/create-pr/route";
import { POST as postHarvestLessons } from "../operations/harvest-lessons/route";
import { POST as postUpdateTodo } from "../operations/update-todo/route";
import { POST as postAnswer } from "../operations/answer/route";
import { POST as postKill } from "../operations/kill/route";
import { GET as listOperations } from "../operations/route";

/** Runs the same handler the web UI posts to, so validation and defaults stay in one place. */
async function viaRoute(handler: (request: Request) => Promise<Response>, body: unknown) {
  const response = await handler(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { data: await response.json(), isError: !response.ok };
}

function routeTool(
  name: string,
  description: string,
  input: z.ZodType,
  handler: (request: Request) => Promise<Response>,
): McpTool {
  return { name, description, input, call: (args) => viaRoute(handler, args) };
}

const STARTS_OPERATION = "Returns the started operation at once; follow it with get_operation.";
const INTERACTION_LEVEL =
  "interactionLevel (low / mid / high) sets how readily the agents stop to ask; omitted, the configured default applies.";

const workspaceInput = z.object({ workspace: z.string().min(1, "workspace is required") });

const RECENT_STATUS_LINES = 8;
const STATUS_LINE_MAX_CHARS = 500;

/**
 * The last progress and error lines, newest last. A failed run's reason lives
 * only here; `__`-prefixed status events are internal phase markers.
 */
function recentStatus(events: OperationEvent[]): string[] {
  const lines: string[] = [];
  for (let i = events.length - 1; i >= 0 && lines.length < RECENT_STATUS_LINES; i--) {
    const { type, data, childLabel } = events[i];
    const label = childLabel ? `${childLabel}: ` : "";
    let line: string | undefined;
    if (type === "status" && !data.startsWith("__")) line = `${label}${data}`;
    else if (type === "error") line = `error: ${label}${data}`;
    if (line) lines.push(line.length > STATUS_LINE_MAX_CHARS ? `${line.slice(0, STATUS_LINE_MAX_CHARS)}…` : line);
  }
  return lines.reverse();
}

async function getOperationStatus(operationId: string) {
  const summary = getOperationSummaries().find((op) => op.id === operationId);
  if (summary) {
    const live = getOperationEvents(operationId);
    // A finished operation's in-memory events are cleared; its log is on disk.
    const events = live.length > 0 ? live : (readOperationLog(operationId)?.events ?? []);
    const ask = summary.hasPendingAsk ? findPendingAsk(eventsToLogEntries(events)) : null;
    return {
      data: {
        ...summary,
        phases: getOperation(operationId)?.phases,
        recentStatus: recentStatus(events),
        ...(ask && {
          pendingQuestion: { toolUseId: ask.toolId, questions: ask.questions, allowFreeText: ask.allowFreeText },
        }),
      },
    };
  }
  const stored = readOperationLog(operationId);
  if (!stored) return { data: `Operation not found: ${operationId}`, isError: true };
  return {
    data: {
      ...stored.operation,
      resultSummary: extractResultSummary(stored.events),
      recentStatus: recentStatus(stored.events),
    },
  };
}

const LIST_INPUT_MAX_CHARS = 200;

function toListEntry({ resultSummary: _result, inputs, ...op }: OperationListItem) {
  if (!inputs) return op;
  const shortened = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      value.length > LIST_INPUT_MAX_CHARS ? `${value.slice(0, LIST_INPUT_MAX_CHARS)}…` : value,
    ]),
  );
  return { ...op, inputs: shortened };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "list_workspaces",
    description: "List workspaces, most recently modified first, with their TODO progress.",
    input: z.object({ includeArchived: z.boolean().optional() }),
    call: async (args) => {
      const { includeArchived } = args as { includeArchived?: boolean };
      return { data: await listWorkspaceItems({ includeArchived }) };
    },
  },
  {
    name: "get_workspace",
    description: "Read one workspace: its metadata, repositories and every TODO item with its status.",
    input: workspaceInput,
    call: async (args) => {
      const name = resolveWorkspaceName((args as { workspace: string }).workspace);
      const summary = await getWorkspaceSummary(name);
      if (!summary) return { data: `Workspace not found: ${name}`, isError: true };
      // `sections` holds every item again, under its heading and with its notes.
      return { data: { ...summary, todos: summary.todos.map(({ items: _items, ...todo }) => todo) } };
    },
  },
  {
    name: "archive_workspace",
    description:
      "Archive a workspace (hidden from list_workspaces by default), or restore it with archived: false. " +
      "Archiving is refused while the workspace has open pull requests unless closeOpenPrs is true, which closes them and deletes their branches. " +
      "Archiving also starts harvest_lessons on the workspace.",
    input: workspaceInput.extend({ archived: z.boolean().default(true), closeOpenPrs: z.boolean().optional() }),
    call: async (args) => {
      const { workspace, archived, closeOpenPrs } = args as { workspace: string; archived: boolean; closeOpenPrs?: boolean };
      const name = resolveWorkspaceName(workspace);
      if (!(await getWorkspaceSummary(name))) return { data: `Workspace not found: ${name}`, isError: true };
      if (!archived) {
        unarchiveWorkspace(name);
        return { data: { workspace: name, archived } };
      }
      try {
        return { data: { workspace: name, archived, ...(await archiveWorkspaceWithPrs(name, { closeOpenPrs })) } };
      } catch (err) {
        if (err instanceof OpenPullRequestsError) {
          return { data: { error: err.message, openPullRequests: err.pullRequests }, isError: true };
        }
        throw err;
      }
    },
  },
  routeTool(
    "init_only",
    "Create a workspace from a task description and stop once its README, repositories and TODOs are planned, without executing anything. " +
      `To take a new task through to pull requests, use autonomous instead. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    initSchema,
    postInit,
  ),
  routeTool(
    "autonomous",
    "The default way to start a new task: pass its description and it creates the workspace, then runs execute → review → gate up to maxLoops (default 3) and creates PRs. " +
      "startWith defaults to init, which needs description; update-todo continues an existing workspace and needs workspace and instruction; execute needs workspace. " +
      `draft (default true) applies to the PRs. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    autonomousSchema.extend({ startWith: autonomousSchema.shape.startWith.default("init") }),
    postAutonomous,
  ),
  routeTool(
    "update_todo",
    `Plan more work into an existing workspace's TODOs from an instruction; repo narrows it to one repository. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    updateTodoSchema,
    postUpdateTodo,
  ),
  routeTool(
    "execute",
    `Carry out a workspace's pending TODO items; repository narrows it to one. ${INTERACTION_LEVEL} ${STARTS_OPERATION}`,
    executeSchema,
    postExecute,
  ),
  routeTool(
    "review",
    `Review a workspace's changes against its README and TODOs; repository narrows it to one. ${STARTS_OPERATION}`,
    reviewSchema,
    postReview,
  ),
  routeTool(
    "harvest_lessons",
    "Distill a workspace's outcome (PR comments, commits people added, a rejected PR, recurring review findings) into candidate lessons " +
      `for its repositories. Archiving starts this on its own; candidates wait for a person to approve them. ${STARTS_OPERATION}`,
    harvestLessonsSchema,
    postHarvestLessons,
  ),
  routeTool(
    "create_pr",
    `Push each repository's branch and open or update its pull request (draft unless draft: false). ${STARTS_OPERATION}`,
    createPrSchema,
    postCreatePr,
  ),
  {
    name: "list_operations",
    description:
      "List operations, running ones first, newest first within that. status narrows it to running or recently finished ones. " +
      "Inputs are shortened and results left out; get_operation has both in full.",
    input: z.object({
      workspace: z.string().optional(),
      status: z.enum(["running", "completed"]).optional(),
      limit: z.number().int().min(1).max(200).default(20),
    }),
    call: async (args) => {
      const { workspace, status, limit } = args as { workspace?: string; status?: string; limit: number };
      const url = new URL("http://localhost/api/operations");
      if (workspace) url.searchParams.set("workspace", resolveWorkspaceName(workspace));
      if (status) url.searchParams.set("status", status);
      url.searchParams.set("limit", String(limit));
      const response = listOperations(new Request(url));
      if (!response.ok) return { data: await response.json(), isError: true };
      const operations = (await response.json()) as OperationListItem[];
      return { data: operations.slice(0, limit).map(toListEntry) };
    },
  },
  {
    name: "get_operation",
    description:
      "Read an operation's status, phases, final result and recentStatus (its last progress and error lines, which say why a failed run stopped). While it waits on a question it carries pendingQuestion; answer it with answer_question.",
    input: z.object({ operationId: z.string().min(1, "operationId is required") }),
    call: async (args) => getOperationStatus((args as { operationId: string }).operationId),
  },
  routeTool(
    "answer_question",
    "Answer an operation's pendingQuestion. answers maps each question's text to the chosen option label (labels joined with \", \" for multi-select) or free text.",
    operationAnswerSchema,
    postAnswer,
  ),
  routeTool("kill_operation", "Stop a running operation.", operationKillSchema, postKill),
];
