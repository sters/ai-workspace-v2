import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import "@testing-library/jest-dom/vitest";

// Use in-memory SQLite for all tests
import { _setDbPath, _resetDb } from "@/lib/db";
_setDbPath(":memory:");

// Set up a temporary workspace root so config.ts doesn't warn about missing AIW_WORKSPACE_ROOT
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-workspace-test-"));
fs.mkdirSync(path.join(testRoot, "workspace"), { recursive: true });
process.env.AIW_WORKSPACE_ROOT = testRoot;

afterAll(() => {
  _resetDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
