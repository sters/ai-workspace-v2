/**
 * The web UI and its HTTP API on one `Bun.serve`.
 * Usage: bun [--hot] run bin/web-server.ts [--hot]
 *
 * `src/client/index.html` is served at every path the API and `public/` do not
 * claim, bundled by Bun with the Tailwind plugin from `[serve.static]` in
 * `bunfig.toml`. With `--hot` the page gets HMR and the server code reloads
 * in place.
 */

import { readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import index from "../src/client/index.html";
import { loadApiRoutes } from "../src/lib/web/api-routes";
import { runWebServerStartup } from "../src/lib/web/startup";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isHot = process.argv.includes("--hot");
const port = Number(process.env.AIW_PORT || "3741");

async function gitHash(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { cwd: projectDir, stdout: "pipe", stderr: "ignore" });
    return (await new Response(proc.stdout).text()).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

process.env.AIW_GIT_HASH ||= await gitHash();
await runWebServerStartup();

const accessLog =
  process.env.AIW_DISABLE_ACCESS_LOG === "true" || process.env.AIW_DISABLE_ACCESS_LOG === "1"
    ? () => {}
    : (line: string) => console.log(line);

const apiRoutes = await loadApiRoutes(resolve(projectDir, "src/app/api"), accessLog);

const publicDir = resolve(projectDir, "public");
const publicRoutes = Object.fromEntries(
  (await readdir(publicDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = resolve(entry.parentPath, entry.name);
      return [`/${file.slice(publicDir.length + 1)}`, () => new Response(Bun.file(file))];
    }),
);

const server = Bun.serve({
  port,
  // Streams (operation events, SSE) stay open far longer than Bun's 10s default.
  idleTimeout: 0,
  development: isHot ? { hmr: true, console: false } : false,
  routes: {
    ...publicRoutes,
    ...apiRoutes,
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
    "/*": index,
  },
  error(error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  },
});

console.log(`[web-server] listening on ${server.url}${isHot ? " (hot)" : ""}`);
