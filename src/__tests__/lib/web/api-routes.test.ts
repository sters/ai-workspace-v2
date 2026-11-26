import path from "node:path";
import { apiRoutePath, bindRouteHandlers } from "@/lib/web/api-routes";

describe("apiRoutePath", () => {
  it("maps dynamic segments to Bun route params", () => {
    expect(apiRoutePath("workspaces/[name]/review/[timestamp]/route.ts")).toBe(
      "/api/workspaces/:name/review/:timestamp",
    );
  });

  it("maps the api root's own route", () => {
    expect(apiRoutePath("route.ts")).toBe("/api");
  });

  it("rejects a catch-all segment, which Bun routes cannot name", () => {
    expect(() => apiRoutePath("files/[...path]/route.ts")).toThrow(/catch-all/);
  });

  it("gives every route under src/app/api a distinct path", async () => {
    const apiDir = path.resolve(__dirname, "../../../app/api");
    const files = await Array.fromAsync(new Bun.Glob("**/route.ts").scan(apiDir));
    const paths = files.map(apiRoutePath);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("bindRouteHandlers", () => {
  it("passes the request's params as the promise the handlers await", async () => {
    const GET = vi.fn(async (_req: Request, ctx: { params: Promise<Record<string, string>> }) =>
      Response.json(await ctx.params),
    );
    const bound = bindRouteHandlers({ GET, helper: () => "not a method" }, () => {});

    expect(Object.keys(bound)).toEqual(["GET"]);
    const req = Object.assign(new Request("http://x/api/workspaces/a%20b"), {
      params: { name: "a b" },
    });
    const res = await bound.GET!(req as never);
    expect(await res.json()).toEqual({ name: "a b" });
  });

  it("logs each request with its status", async () => {
    const log = vi.fn();
    const bound = bindRouteHandlers(
      { POST: async () => new Response(null, { status: 201 }) },
      log,
    );
    const req = Object.assign(new Request("http://x/api/things?q=1", { method: "POST" }), {
      params: {},
    });
    await bound.POST!(req as never);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^POST \/api\/things\?q=1 201 in \d+ms$/));
  });
});
