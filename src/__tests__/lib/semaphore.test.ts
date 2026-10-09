import { describe, it, expect } from "vitest";
import { Semaphore } from "@/lib/semaphore";

describe("Semaphore", () => {

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
