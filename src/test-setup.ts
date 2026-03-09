import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import "@testing-library/jest-dom/vitest";

// Set up a temporary workspace root so config.ts doesn't warn about missing AI_WORKSPACE_ROOT
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-workspace-test-"));
fs.mkdirSync(path.join(testRoot, "workspace"), { recursive: true });
process.env.AI_WORKSPACE_ROOT = testRoot;

afterAll(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});
