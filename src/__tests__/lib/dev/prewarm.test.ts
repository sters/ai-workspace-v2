import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  discoverPageRoutes,
  prewarmRoutes,
  resolvePrewarmPaths,
  waitForServer,
} from "@/lib/dev/prewarm";

describe("discoverPageRoutes", () => {
  let appDir: string;

  function seedPage(routeDir: string) {
    const dir = path.join(appDir, routeDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "page.tsx"), "export default function P() {}\n");
  }

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join("/tmp", "aiw-prewarm-app-"));
  });

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it("maps nested page files to their URL paths, root included", () => {
    seedPage(".");
    seedPage("new/quick");
    seedPage("utilities");

    expect(discoverPageRoutes(appDir)).toEqual(["/", "/new/quick", "/utilities"]);
  });

  it("keeps dynamic segments in place for the caller to fill", () => {
    seedPage("workspace/[name]/todo");

    expect(discoverPageRoutes(appDir)).toEqual(["/workspace/[name]/todo"]);
  });

  it("drops a route group's parentheses from the URL, as Next does", () => {
    seedPage("(marketing)/about");

    expect(discoverPageRoutes(appDir)).toEqual(["/about"]);
  });

  it("ignores directories Next does not route: private and parallel-route slots", () => {
    seedPage("_components/preview");
    seedPage("@modal/photo");
    seedPage("visible");

    expect(discoverPageRoutes(appDir)).toEqual(["/visible"]);
  });

  it("ignores a directory that only holds a layout or an api route", () => {
    fs.mkdirSync(path.join(appDir, "shell"), { recursive: true });
    fs.writeFileSync(path.join(appDir, "shell", "layout.tsx"), "export default function L() {}\n");
    fs.mkdirSync(path.join(appDir, "api", "config"), { recursive: true });
    fs.writeFileSync(path.join(appDir, "api", "config", "route.ts"), "export const GET = 1;\n");

    expect(discoverPageRoutes(appDir)).toEqual([]);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(discoverPageRoutes(path.join(appDir, "missing"))).toEqual([]);
  });
});

describe("resolvePrewarmPaths", () => {
  it("fills a known dynamic segment", () => {
    expect(
      resolvePrewarmPaths(["/workspace/[name]/todo"], { name: "sample" }),
    ).toEqual(["/workspace/sample/todo"]);
  });

  it("drops a route whose parameter it has no value for", () => {
    expect(resolvePrewarmPaths(["/workspace/[name]/review/[timestamp]"], { name: "sample" })).toEqual(
      [],
    );
  });

  it("drops catch-all routes, which have no single representative path", () => {
    expect(
      resolvePrewarmPaths(["/docs/[...slug]", "/files/[[...path]]"], { slug: "a", path: "b" }),
    ).toEqual([]);
  });

  it("deduplicates paths that different routes resolve to", () => {
    expect(resolvePrewarmPaths(["/a", "/a"], {})).toEqual(["/a"]);
  });
});

describe("prewarmRoutes", () => {
  it("requests every path once and counts the outcomes", async () => {
    const seen: string[] = [];
    const result = await prewarmRoutes("http://127.0.0.1:3741", ["/", "/new"], {
      fetch: async (url) => {
        seen.push(url);
        return { ok: true };
      },
    });

    expect(seen).toEqual(["http://127.0.0.1:3741/", "http://127.0.0.1:3741/new"]);
    expect(result).toEqual({ ok: 2, failed: 0 });
  });

  // A prewarm is a background nicety; one route that throws (or 500s on a page
  // whose own code is broken) must not cost the rest of the sweep.
  it("keeps going past a route that throws", async () => {
    const result = await prewarmRoutes("http://127.0.0.1:3741", ["/a", "/b", "/c"], {
      fetch: async (url) => {
        if (url.endsWith("/b")) throw new Error("compile failed");
        return { ok: true };
      },
    });

    expect(result).toEqual({ ok: 2, failed: 1 });
  });

  it("holds concurrency at the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await prewarmRoutes("http://x", ["/a", "/b", "/c", "/d", "/e"], {
      concurrency: 2,
      fetch: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { ok: true };
      },
    });

    expect(peak).toBe(2);
  });

  // The signal is the dev server going away: the remaining requests would hang
  // or error, and there is nothing left to warm.
  it("stops requesting once aborted", async () => {
    const controller = new AbortController();
    let requested = 0;
    const result = await prewarmRoutes("http://x", ["/a", "/b", "/c", "/d"], {
      concurrency: 1,
      signal: controller.signal,
      fetch: async () => {
        requested++;
        if (requested === 2) controller.abort();
        return { ok: true };
      },
    });

    expect(requested).toBe(2);
    expect(result).toEqual({ ok: 2, failed: 0 });
  });
});

describe("waitForServer", () => {
  it("returns true on the first answered request", async () => {
    let calls = 0;
    const ready = await waitForServer("http://x/", {
      fetch: async () => {
        calls++;
        return { ok: true };
      },
      sleep: async () => {},
    });

    expect(ready).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries while the port refuses, then succeeds", async () => {
    let calls = 0;
    const slept: number[] = [];
    const ready = await waitForServer("http://x/", {
      attempts: 5,
      intervalMs: 200,
      fetch: async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return { ok: true };
      },
      sleep: async (ms) => void slept.push(ms),
    });

    expect(ready).toBe(true);
    expect(calls).toBe(3);
    expect(slept).toEqual([200, 200]);
  });

  it("gives up after the attempt budget rather than waiting forever", async () => {
    let calls = 0;
    const ready = await waitForServer("http://x/", {
      attempts: 3,
      fetch: async () => {
        calls++;
        throw new Error("ECONNREFUSED");
      },
      sleep: async () => {},
    });

    expect(ready).toBe(false);
    expect(calls).toBe(3);
  });

  it("stops waiting when the caller aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const ready = await waitForServer("http://x/", {
      attempts: 10,
      signal: controller.signal,
      fetch: async () => {
        calls++;
        controller.abort();
        throw new Error("ECONNREFUSED");
      },
      sleep: async () => {},
    });

    expect(ready).toBe(false);
    expect(calls).toBe(1);
  });
});
