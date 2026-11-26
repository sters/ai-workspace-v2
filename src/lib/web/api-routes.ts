/**
 * The HTTP API's route table for `Bun.serve`, built from the route modules
 * under `src/app/api/`: `<path>/route.ts` serves `/api/<path>`, a `[param]`
 * directory is a path parameter, and each exported `GET` / `POST` / … handles
 * that method. Handlers take `(request, { params })` with `params` a promise,
 * the shape the MCP tools also call them with.
 */
import path from "node:path";
import type { BunRequest } from "bun";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>;

export type BoundHandlers = Partial<Record<Method, (request: BunRequest) => Promise<Response>>>;

/** `workspaces/[name]/route.ts` (relative to the api directory) → `/api/workspaces/:name`. */
export function apiRoutePath(file: string): string {
  const segments = path
    .dirname(file)
    .split(/[\\/]/)
    .filter((segment) => segment && segment !== ".")
    .map((segment) => {
      if (!segment.startsWith("[")) return segment;
      if (segment.includes("...")) throw new Error(`catch-all segment is not supported: ${file}`);
      return `:${segment.slice(1, -1)}`;
    });
  return ["/api", ...segments].join("/");
}

export function bindRouteHandlers(
  mod: Record<string, unknown>,
  log: (line: string) => void,
): BoundHandlers {
  const bound: BoundHandlers = {};
  for (const method of METHODS) {
    const handler = mod[method];
    if (typeof handler !== "function") continue;
    bound[method] = async (request) => {
      const startedAt = performance.now();
      const response = await (handler as RouteHandler)(request, {
        params: Promise.resolve(request.params as Record<string, string>),
      });
      const url = new URL(request.url);
      log(
        `${method} ${url.pathname}${url.search} ${response.status} in ${Math.round(performance.now() - startedAt)}ms`,
      );
      return response;
    };
  }
  return bound;
}

export async function loadApiRoutes(
  apiDir: string,
  log: (line: string) => void,
): Promise<Record<string, BoundHandlers>> {
  const routes: Record<string, BoundHandlers> = {};
  for await (const file of new Bun.Glob("**/route.ts").scan(apiDir)) {
    const mod = (await import(path.join(apiDir, file))) as Record<string, unknown>;
    routes[apiRoutePath(file)] = bindRouteHandlers(mod, log);
  }
  return routes;
}
