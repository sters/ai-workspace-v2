import { vi, type Mock } from "bun:test";

/** Types a function that a `vi.mock` factory or `vi.spyOn` replaced as the mock it is. */
export function mocked<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  return fn as unknown as Mock<T>;
}

const stubbed = new Map<PropertyKey, PropertyDescriptor | undefined>();

/** Replaces `globalThis[name]` until `unstubAllGlobals()` puts every stubbed global back. */
export function stubGlobal(name: PropertyKey, value: unknown): void {
  if (!stubbed.has(name)) stubbed.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
}

export function unstubAllGlobals(): void {
  for (const [name, descriptor] of stubbed) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<PropertyKey, unknown>)[name];
  }
  stubbed.clear();
}

/** Retries `callback` until it neither throws nor rejects, failing with its last error after `timeout` ms. */
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  { timeout = 1000, interval = 20 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await callback();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await Bun.sleep(interval);
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * Advances fake timers by `ms`, letting promise callbacks run between steps, so a timer that
 * an awaited callback schedules is due no later than one `step` after it would be in real time.
 */
export async function advanceTimersByTimeAsync(ms: number, step = Math.min(ms, 100)): Promise<void> {
  for (let left = ms; left > 0; left -= step) {
    await flushMicrotasks();
    vi.advanceTimersByTime(Math.min(step, left));
  }
  await flushMicrotasks();
}
