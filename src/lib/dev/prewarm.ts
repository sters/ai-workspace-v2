/**
 * Compile the App Router's page routes before the human clicks one.
 *
 * `next dev` compiles a route on its first request, so on a freshly started
 * dev server the first visit to every page is paid by whoever visits it.
 * Measured on this app with an empty `.next` (Next 16.2, Turbopack): ~0.2-0.7s
 * of server work per page route, ~10s for all 33 of them, against ~30ms once
 * compiled. Sweeping them in the background right after boot moves that cost
 * off the click.
 *
 * Only page routes are swept. API routes compile in ~0.1s on first hit, and a
 * GET is not free of consequence for all of them (`gh` calls, spawns), so they
 * are left to the request that actually wants them.
 *
 * Every dependency this touches is injected because the sweep runs from
 * `bin/next-server.ts`, which is outside the test suite's reach.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Semaphore } from "@/lib/semaphore";

/** Stand-in for a dynamic segment. Compilation is per route, not per param. */
export const PREWARM_PARAM_VALUE = "_prewarm";

const DEFAULT_CONCURRENCY = 4;

/**
 * Page routes under an App Router directory, as URL paths with dynamic
 * segments left in place for `resolvePrewarmPaths` to fill.
 */
export function discoverPageRoutes(appDir: string): string[] {
  const routes: string[] = [];

  function walk(dir: string, segments: string[]) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no such directory, or unreadable — nothing to warm
    }

    if (entries.some((e) => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))) {
      routes.push(`/${segments.join("/")}`);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // `_private` holds no routes and `@slot` is a parallel route rendered
      // inside its parent, so neither is a URL of its own.
      if (name.startsWith("_") || name.startsWith("@")) continue;
      // A route group — and an interception marker, `(.)` / `(..)` — adds a
      // directory without adding a URL segment.
      if (name.startsWith("(")) {
        walk(join(dir, name), segments);
        continue;
      }
      walk(join(dir, name), [...segments, name]);
    }
  }

  walk(appDir, []);
  return routes.sort();
}

/**
 * Concrete paths to request: single dynamic segments filled from `params`,
 * anything left unresolved dropped.
 *
 * A catch-all has no single representative path, and a parameter with no value
 * would be requested literally as `[name]`, so both are dropped rather than
 * guessed — one unwarmed route costs a compile on click, a wrong URL costs a
 * confusing 404 in the log.
 */
export function resolvePrewarmPaths(
  routes: string[],
  params: Record<string, string>,
): string[] {
  const paths = new Set<string>();

  for (const route of routes) {
    const filled = route.split("/").map((segment) => {
      if (!segment.startsWith("[")) return segment;
      if (segment.includes("...")) return null; // `[...slug]` / `[[...slug]]`
      return params[segment.slice(1, -1)] ?? null;
    });
    if (filled.some((segment) => segment === null)) continue;
    paths.add(filled.join("/"));
  }

  return [...paths];
}

export interface PrewarmOptions {
  fetch: (url: string) => Promise<unknown>;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface PrewarmResult {
  ok: number;
  failed: number;
}

/**
 * Request each path once, ignoring what comes back. A page whose own code is
 * broken answers 500 and is still compiled; a request that throws is counted
 * and skipped, since a background nicety must not be able to take down the
 * sweep it is part of.
 */
export async function prewarmRoutes(
  baseUrl: string,
  paths: string[],
  { fetch, concurrency = DEFAULT_CONCURRENCY, signal }: PrewarmOptions,
): Promise<PrewarmResult> {
  const semaphore = new Semaphore(concurrency);
  let ok = 0;
  let failed = 0;

  await Promise.all(
    paths.map((path) =>
      semaphore.run(async () => {
        if (signal?.aborted) return;
        try {
          await fetch(`${baseUrl}${path}`);
          ok++;
        } catch {
          failed++;
        }
      }),
    ),
  );

  return { ok, failed };
}

export interface WaitForServerOptions {
  fetch: (url: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  /** Attempts rather than a deadline, so the wait is bounded without a clock. */
  attempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Poll until the dev server answers at all. The first answered request is also
 * the first route compiled, which is why the caller asks for `/` here.
 */
export async function waitForServer(
  url: string,
  { fetch, sleep, attempts = 300, intervalMs = 200, signal }: WaitForServerOptions,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) return false;
    try {
      await fetch(url);
      return true;
    } catch {
      if (signal?.aborted) return false;
      if (attempt < attempts - 1) await sleep(intervalMs);
    }
  }
  return false;
}
