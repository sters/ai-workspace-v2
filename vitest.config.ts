import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

/**
 * Only `components/` and `hooks/` need a DOM. Applying `environment: "jsdom"`
 * to the whole suite built a jsdom per test file — `forks` + `isolate` gives
 * each file its own process, so nothing is shared — and that cost more than
 * every other phase of the run put together (264s of cumulative environment
 * setup against a 22s wall clock, and ~150MB of a worker's RSS).
 *
 * `hooks/` goes to the DOM project as a directory rather than by extension:
 * two of its files are `.ts` and still render.
 */
const DOM_TESTS = [
  "src/__tests__/components/**/*.{test,spec}.{ts,tsx}",
  "src/__tests__/hooks/**/*.{test,spec}.{ts,tsx}",
];

const shared = {
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
};

export default defineConfig({
  ...shared,
  test: {
    /**
     * `forks` + `isolate` (both defaults) give every test file its own process,
     * so the peak is the worker count times a worker — nothing is shared and
     * there is nothing to reclaim. The default of one worker per core bar one
     * measured *slower* than this on a 10-core machine (15s at 9 workers, 14s
     * at 6) because the main vite process and the workers then contend, so the
     * cap costs no wall clock and takes ~25% off the peak. Root-level: workers
     * are a pool-wide setting, not a per-project one.
     */
    maxWorkers: "60%",
    projects: [
      {
        ...shared,
        test: {
          name: "node",
          globals: true,
          environment: "node",
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/__tests__/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...DOM_TESTS, "**/node_modules/**"],
        },
      },
      {
        ...shared,
        test: {
          name: "dom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["./src/test-setup.ts", "./src/test-setup-dom.ts"],
          include: DOM_TESTS,
        },
      },
    ],
  },
});
