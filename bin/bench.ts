/**
 * Bench one step's model / effort pairings against a workspace.
 *
 *   bun run bench --workspace <name> --step <step> [--repo <worktree>]
 *     [--configs opus/medium,claude-haiku-5-5/xhigh] [--repeats 2]
 *     [--concurrency 4] [--ttl 1h|5m] [--out-dir <dir>] [--root <workspace root>]
 *     [--dry-run] [--list]
 *
 * Every pairing runs the child the pipeline would build for that step, read-only
 * and outside any operation; nothing is written to the workspace or the database.
 * The answers are written for a reader to compare, not scored:
 *
 *   <out-dir>/prompt.md                  the child's prompt and system prompt file
 *   <out-dir>/answers/<pairing>-<n>.json one attempt: answer plus cost, time, tokens, turns
 *   <out-dir>/summary.json               per-pairing averages
 *
 * `--out-dir` defaults to `<root>/.ai-workspace/bench/<timestamp>-<step>`.
 * `--dry-run` builds the child and prints its size without calling Claude;
 * `--list` lists the steps. Each attempt is a real, billed Claude run.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    root: { type: "string" },
    workspace: { type: "string" },
    step: { type: "string" },
    repo: { type: "string" },
    configs: { type: "string", default: "opus/medium,claude-haiku-5-5/xhigh" },
    repeats: { type: "string", default: "2" },
    concurrency: { type: "string", default: "4" },
    ttl: { type: "string", default: "1h" },
    "out-dir": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

// Before anything reads the configuration, which caches the root it resolves.
const root = path.resolve(args.root ?? process.env.AIW_WORKSPACE_ROOT ?? process.cwd());
process.env.AIW_WORKSPACE_ROOT = root;

const { BENCH_STEPS } = await import("../src/lib/bench/steps");
const { runBench } = await import("../src/lib/bench/run");
const { listWorkspaceRepos } = await import("../src/lib/workspace");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (args.list) {
  for (const s of BENCH_STEPS.values()) console.log(`${s.stepType.padEnd(22)} ${s.label}${s.perRepo ? " (per repository)" : ""}`);
  process.exit(0);
}

if (!args.workspace) fail("--workspace is required");
if (!args.step) fail(`--step is required: one of ${[...BENCH_STEPS.keys()].join(", ")}`);
const step = BENCH_STEPS.get(args.step) ?? fail(`Unknown step ${args.step}`);

let repo = args.repo;
if (step.perRepo && !repo) {
  repo = (await listWorkspaceRepos(args.workspace))[0]?.repoName ?? fail(`${args.workspace} has no repositories`);
  console.log(`repository: ${repo} (pass --repo to choose)`);
}

if (args["dry-run"]) {
  const built = await step.build(args.workspace, repo);
  if ("error" in built) fail(built.error);
  console.log(`prompt ${built.prompt.length} chars, schema ${built.jsonSchema ? "yes" : "no"}, addDirs ${JSON.stringify(built.addDirs ?? [])}, system prompt ${built.appendSystemPromptFile ?? "-"}`);
  process.exit(0);
}

const configs = args.configs.split(",").map((c) => c.trim()).filter(Boolean);
const repeats = Number(args.repeats);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
const outDir = path.resolve(args["out-dir"] ?? path.join(root, ".ai-workspace", "bench", `${stamp}-${args.step}`));
console.log(`bench ${args.step} on ${args.workspace}${repo ? ` / ${repo}` : ""}: ${configs.join(", ")} x ${repeats}`);

const result = await runBench({
  workspace: args.workspace,
  step: args.step,
  repo,
  configs,
  repeats,
  concurrency: Number(args.concurrency),
  ttl: args.ttl === "5m" ? "5m" : "1h",
  onAttempt: (a) =>
    console.log(`  ${a.label.padEnd(30)} ${a.ok ? "ok    " : "FAILED"} $${a.costUsd.toFixed(3)}  ${Math.round(a.durationMs / 1000)}s  ${a.outputTokens} out  ${a.numTurns} turns`),
});
if ("error" in result) fail(result.error);

const fileName = (label: string) => label.replace(/[^\w.-]+/g, "_");
await mkdir(path.join(outDir, "answers"), { recursive: true });
await Bun.write(
  path.join(outDir, "prompt.md"),
  `# ${args.step} — ${args.workspace}${repo ? ` / ${repo}` : ""}\n\nSystem prompt file: ${result.appendSystemPromptFile ?? "-"}\n\n## Prompt\n\n${result.prompt}\n`,
);
for (const a of result.attempts) {
  let answer: unknown = a.text;
  try {
    answer = JSON.parse(a.text);
  } catch {
    // kept as text
  }
  await Bun.write(path.join(outDir, "answers", `${fileName(a.label)}.json`), JSON.stringify({ ...a, text: undefined, answer }, null, 2));
}
await Bun.write(
  path.join(outDir, "summary.json"),
  JSON.stringify({ step: result.step, workspace: args.workspace, repo: result.repo, configs, repeats, summary: result.summary }, null, 2),
);

const cell = (n: number | null, f: (n: number) => string) => (n === null ? "-" : f(n));
console.log("");
console.log(`${"pairing".padEnd(26)} ${"answered".padStart(8)} ${"avg $".padStart(8)} ${"avg time".padStart(9)} ${"avg out".padStart(8)} ${"turns".padStart(6)}`);
for (const s of result.summary) {
  console.log(
    `${s.config.padEnd(26)} ${`${s.succeeded}/${s.attempts}`.padStart(8)} ${cell(s.avgCostUsd, (n) => n.toFixed(3)).padStart(8)} ${cell(s.avgDurationMs, (n) => `${Math.round(n / 1000)}s`).padStart(9)} ${cell(s.avgOutputTokens, (n) => String(Math.round(n))).padStart(8)} ${cell(s.avgTurns, (n) => n.toFixed(1)).padStart(6)}`,
  );
}
console.log(`\nanswers: ${outDir}`);
process.exit(0);
