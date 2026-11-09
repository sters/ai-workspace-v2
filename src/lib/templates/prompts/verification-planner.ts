/**
 * Prompt for the verification planner: writes the step lists the Verify tab
 * runs to check a workspace's change in a running app, or rewrites the rest of
 * one that stopped.
 *
 * The planner only reads. Its commands run later, unattended, through the
 * Verify tab's runner, so everything here is about writing steps that hold up
 * without it: non-interactive commands, readiness checks for servers, values
 * passed between steps through variables, and human steps only where a human
 * is the only one who can do it.
 */

import type { VerificationPlannerInput } from "@/types/prompts";
import { NO_CD_RULES, REPO_SEARCH_EFFICIENCY, STOP_WHEN_ANSWERED } from "./shared";

const STEP_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short imperative title." },
    actor: { type: "string", enum: ["claude", "human"] },
    repo: { type: "string", description: "Worktree directory name the command runs in. Omit to run in the workspace directory." },
    command: { type: "string", description: "Claude steps: a non-interactive shell command (sh -c). {{name}} expands to a shell-quoted variable." },
    background: { type: "boolean", description: "Claude steps: the command keeps running (a dev server, a watcher) and is stopped at the end." },
    readyCommand: { type: "string", description: "Background steps: a quick command that exits 0 once the process is ready, polled every 2s for up to 3 minutes." },
    outputs: {
      type: "array",
      items: { type: "string" },
      description: "Claude steps: variable names taken from stdout — the keys of one JSON object printed on stdout, or for a single name the whole trimmed stdout.",
    },
    instructions: { type: "string", description: "Human steps: what to do, in Markdown — URL, account, what to click. {{name}} expands to a variable." },
    inputs: {
      type: "array",
      description: "Human steps: values the human types in or picks, stored as variables for later steps.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Variable name: letters, digits, underscore." },
          label: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "Makes it a choice." },
        },
        required: ["name", "label"],
        additionalProperties: false,
      },
    },
    expected: { type: "string", description: "What passing looks like, concretely." },
    criteria: { type: "array", items: { type: "string" }, description: "Acceptance criteria this step's pass establishes, quoted from the README." },
    teardown: { type: "boolean", description: "Runs when the scenario ends, however it ends. Claude steps only." },
  },
  required: ["title", "actor", "expected"],
  additionalProperties: false,
} as const;

export const VERIFICATION_PLAN_SCHEMA = {
  type: "object",
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string", description: "One or two sentences: what this scenario shows." },
          steps: { type: "array", items: STEP_SCHEMA },
        },
        required: ["title", "summary", "steps"],
        additionalProperties: false,
      },
    },
  },
  required: ["scenarios"],
  additionalProperties: false,
} as const;

export function getVerificationPlannerSystemPrompt(): string {
  return `You plan how to check that a code change works when the software actually runs — the check a developer does in a local or dev environment after the tests pass. You write it as scenarios: ordered steps that a runner carries out later.

**Read-only.** Read code, docs and configuration to work out how the software starts and how the change shows up; run only read-only \`git\` commands. Never start anything yourself — your commands run later.

### How the steps are run

- Steps run strictly in order. A \`claude\` step is a shell command run unattended with \`sh -c\`, no TTY, no stdin, a 10-minute limit; it passes on exit 0. A \`human\` step stops the run until a person answers OK or NG.
- A command runs in the worktree named by \`repo\`, or in the workspace directory without one. Each step is a fresh shell, so a \`cd\` or an \`export\` does not carry over; put it in the command that needs it.
- A long-running process (dev server, docker compose in the foreground, a worker) is a \`background\` step with a \`readyCommand\` that exits 0 once it serves — e.g. \`curl -sf http://localhost:3000/health\`. It stays up through later steps, including human ones, and is stopped when the scenario ends, so it needs no stop step of its own. Something started detached (\`docker compose up -d\`) does need a \`teardown\` step (\`docker compose down\`).
- Values pass between steps through variables. A \`claude\` step lists \`outputs\` and prints them as one JSON object on stdout (\`... | jq -c '{order_id: .id}'\`); a \`human\` step lists \`inputs\`. Later steps use \`{{name}}\`. Use this for anything one step creates and another needs: an id, a port, a token.

### Who does what

Give Claude everything a command can establish: installing dependencies, starting services, migrations, seed data, calling an endpoint and checking the response with \`jq\` / \`grep\`, reading a log, querying a local database.

A human step is for what a command cannot do (non-exhaustive):
- judging how something looks or feels in a browser or a device;
- signing in through SSO, 2FA or anything else that needs a person's credentials;
- an environment Claude has no access to, or a shared one where acting is a decision (a dev or staging deployment, a third-party sandbox);
- a sign-off someone owns.

Put the Claude steps that prepare a human step right before it, and make the human step short and concrete: the URL with the real port and ids (\`{{order_id}}\`), the account, what to click, what to look for. Ask for a value with \`inputs\` when a later step needs what the person saw or chose.

Commands stay on this machine: nothing that deploys, pushes, publishes, or writes to a shared or remote environment. Those are human steps.

### Scenarios

One scenario per independent flow that needs its own setup or its own check — usually one per group of related acceptance criteria. Each scenario is self-contained: it starts what it needs and tears down what it started. Do not plan a scenario for something the existing test suite already covers; plan the checks that need the software running.

When the change has nothing a running check would add (documentation, a refactor fully covered by tests), return an empty \`scenarios\` list.

### Language

Write titles, summaries, instructions and expected results in the language the README is written in — a person reads them. Commands stay as they are.

${STOP_WHEN_ANSWERED}

${NO_CD_RULES}

${REPO_SEARCH_EFFICIENCY}

### Output

Respond with a JSON object matching the schema.`;
}

export function buildVerificationPlannerPrompt(input: VerificationPlannerInput): string {
  const repos = input.repos.length > 0
    ? input.repos.map((r) => `### ${r.repoName}\n\n- Worktree: \`${r.worktreePath}\`\n- Base branch: \`${r.baseBranch}\`\n\n${r.changes}`).join("\n\n")
    : "(no repositories on disk)";

  const task = input.replan
    ? `## Task: Rewrite the rest of a scenario that stopped

The scenario below stopped at the first step that is not \`passed\` or \`skipped\`. Everything before that step has been done, its variables are set, and its background processes are still running. Return exactly one scenario whose \`steps\` replace that step and everything after it, teardown included — adjust to what the results, the notes and the person's request say, and do not repeat what is already done unless it has to be done again (a server that must restart to pick up a change).

### The scenario so far

\`\`\`json
${input.replan.scenarioJson}
\`\`\`
`
    : `## Task: Plan verification scenarios

Plan the scenarios that check this workspace's change in the running software.${input.existingTitles.length > 0 ? `\n\nThese scenarios already exist; plan only what they do not cover:\n${input.existingTitles.map((t) => `- ${t}`).join("\n")}` : ""}
`;

  return `# Verification Plan: ${input.workspaceName}

${task}${input.instruction ? `\n## Request from the person running the check\n\n${input.instruction}\n` : ""}
## Workspace directory

\`${input.workspacePath}\`

## README

${input.readmeContent}

## Repositories

${repos}
`;
}
