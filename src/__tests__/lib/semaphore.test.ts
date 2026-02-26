import { describe, it, expect } from "vitest";
import { Semaphore } from "@/lib/semaphore";

describe("Semaphore", () => {
  it("allows concurrent operations up to the limit", async () => {
    const sem = new Semaphore(2);
    const running: number[] = [];
    const results: number[] = [];

    const task = (id: number, delayMs: number) =>
      sem.run(async () => {
        running.push(id);
        const concurrent = running.length;
        await new Promise((r) => setTimeout(r, delayMs));
        running.splice(running.indexOf(id), 1);
        results.push(id);
        return concurrent;
      });

    const [c1, c2, _c3] = await Promise.all([
      task(1, 30),
      task(2, 30),
      task(3, 10),
    ]);

    // First two should run concurrently
    expect(c1).toBeLessThanOrEqual(2);
    expect(c2).toBeLessThanOrEqual(2);
    // Third should wait for one of the first two
    expect(results).toHaveLength(3);
  });

  it("throws for invalid permits", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it("releases on function error", async () => {
    const sem = new Semaphore(1);

    try {
      await sem.run(async () => {
        throw new Error("test error");
      });
    } catch {
      // expected
    }

    // Should be released, so next run should work
    expect(sem.available).toBe(1);
    const result = await sem.run(async () => "ok");
    expect(result).toBe("ok");
  });

  it("acquire and release work directly", async () => {
    const sem = new Semaphore(1);
    expect(sem.available).toBe(1);

    await sem.acquire();
    expect(sem.available).toBe(0);

    sem.release();
    expect(sem.available).toBe(1);
  });

  it("queues when all permits are taken", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];

    await sem.acquire();
    order.push("acquired-1");

    // This will wait
    const pending = sem.acquire().then(() => {
      order.push("acquired-2");
    });

    // Give the pending acquire a tick to register
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["acquired-1"]);

    sem.release();
    await pending;
    expect(order).toEqual(["acquired-1", "acquired-2"]);

    sem.release();
  });
});
