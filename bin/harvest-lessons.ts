/**
 * Harvest lessons from workspaces archived before archiving did it on its own.
 *
 *   bun run harvest-lessons [--root <workspace root>] [--port 3741] [--workspace <name> ...] [--dry-run]
 *
 * Asks the running server to run `harvest-lessons` on each archived workspace
 * (or only the named ones), one at a time, waiting for each to finish. Each run
 * is a billed Claude call per repository that has something to learn from.
 * Candidates land in Utilities → Repo Lessons; nothing is approved here.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { setWorkspaceRoot } from "../src/lib/config";
import { listArchivedWorkspaces } from "../src/lib/db/archives";

const { values: args } = parseArgs({
  options: {
    root: { type: "string" },
    port: { type: "string", default: process.env.AIW_PORT ?? "3741" },
    workspace: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
  },
});

setWorkspaceRoot(resolve(args.root ?? process.env.AIW_WORKSPACE_ROOT ?? process.cwd()));
const base = `http://localhost:${args.port}`;
const targets = args.workspace?.length ? args.workspace : listArchivedWorkspaces().map((w) => w.name);

console.log(`${targets.length} workspace(s): ${targets.join(", ") || "(none)"}`);
if (args["dry-run"]) process.exit(0);

async function waitFor(id: string): Promise<string> {
  for (;;) {
    await Bun.sleep(10_000);
    const running = (await (await fetch(`${base}/api/operations?status=running`)).json()) as { id: string }[];
    if (!running.some((op) => op.id === id)) return "finished";
  }
}

for (const workspace of targets) {
  const res = await fetch(`${base}/api/operations/harvest-lessons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) {
    console.error(`${workspace}: could not start (${body.error ?? res.status})`);
    continue;
  }
  console.log(`${workspace}: started ${body.id}`);
  console.log(`${workspace}: ${await waitFor(body.id)}`);
}
console.log("Done. Review the candidates at Utilities → Repo Lessons.");
