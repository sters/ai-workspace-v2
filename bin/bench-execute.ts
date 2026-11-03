/**
 * Bench the executor's model / effort pairings on one repository's TODO.
 *
 *   bun run bench:execute --workspace <name> --repo <worktree>
 *     [--from <workspace commit>] [--start <repository commit>]
 *     [--configs opus/medium,claude-sonnet-5-5/high] [--repeats 1]
 *     [--concurrency 2] [--ttl 1h|5m] [--out-dir <dir>] [--root <workspace root>]
 *
 * The plan is the README and TODO at `--from` (default: the workspace's last
 * `Init complete` snapshot); every attempt starts from `--start` (default: the
 * branch's merge-base with its base) in a sandbox worktree of the same clone,
 * removed afterwards. The real workspace and worktree are not touched. Writes:
 *
 *   <out-dir>/prompt.md, baseline.constraints.md   the executor prompt; constraints at the start commit
 *   <out-dir>/answers/<pairing>_<n>.{json,patch,todo.md,constraints.md,result.md}
 *   <out-dir>/summary.json
 *
 * `--out-dir` defaults to `<root>/.ai-workspace/bench/<timestamp>-execute`.
 * Each attempt is a real, billed Claude run that edits and commits code.
 */

import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    root: { type: "string" },
    workspace: { type: "string" },
    repo: { type: "string" },
    from: { type: "string" },
    start: { type: "string" },
    configs: { type: "string", default: "opus/medium,claude-sonnet-5-5/high" },
    repeats: { type: "string", default: "1" },
    concurrency: { type: "string", default: "2" },
    ttl: { type: "string", default: "1h" },
    "out-dir": { type: "string" },
  },
});

const root = path.resolve(args.root ?? process.env.AIW_WORKSPACE_ROOT ?? process.cwd());
process.env.AIW_WORKSPACE_ROOT = root;

const { runExecuteBench } = await import("../src/lib/bench/execute");

if (!args.workspace || !args.repo) {
  console.error("--workspace and --repo are required");
  process.exit(1);
}

const configs = args.configs.split(",").map((c) => c.trim()).filter(Boolean);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
const outDir = path.resolve(args["out-dir"] ?? path.join(root, ".ai-workspace", "bench", `${stamp}-execute`));
console.log(`bench execute on ${args.workspace} / ${args.repo}: ${configs.join(", ")} x ${args.repeats}`);

const result = await runExecuteBench({
  workspace: args.workspace,
  repo: args.repo,
  from: args.from,
  start: args.start,
  configs,
  repeats: Number(args.repeats),
  concurrency: Number(args.concurrency),
  ttl: args.ttl === "5m" ? "5m" : "1h",
  outDir,
  onAttempt: (line) => console.log(line),
});
if ("error" in result) {
  console.error(result.error);
  process.exit(1);
}

await Bun.write(
  path.join(outDir, "summary.json"),
  JSON.stringify({ workspace: args.workspace, repo: args.repo, from: result.from, start: result.start, baseline: result.baseline, summary: result.summary }, null, 2),
);
console.log(`\nbaseline: ${result.baseline.map((c) => `${c.label} ${c.status}`).join(", ") || "(no constraints)"}`);
for (const s of result.summary) {
  console.log(`${s.config.padEnd(26)} ${s.succeeded}/${s.attempts}  $${s.avgCostUsd?.toFixed(3) ?? "-"}  ${s.avgDurationMs === null ? "-" : `${Math.round(s.avgDurationMs / 1000)}s`}`);
}
console.log(`\nanswers: ${outDir}`);
process.exit(0);
