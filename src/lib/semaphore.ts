/**
 * Counting semaphore for limiting concurrent async operations.
 */
export class Semaphore {
  private _permits: number;
  private readonly _queue: (() => void)[] = [];

  constructor(permits: number) {
    if (permits < 1) throw new Error("Semaphore permits must be >= 1");
    this._permits = permits;
  }

  async acquire(): Promise<void> {
    if (this._permits > 0) {
      this._permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    const next = this._queue.shift();
    if (next) {
      next();
    } else {
      this._permits++;
    }
  }

  /** Run fn with a semaphore permit, automatically releasing on completion. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get available(): number {
    return this._permits;
  }
}
