import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readScenario, verificationDir } from "@/lib/verification/store";

let wsPath: string;

beforeEach(async () => {
  wsPath = await mkdtemp(path.join(os.tmpdir(), "aiw-verify-store-"));
});

afterEach(async () => {
  await rm(wsPath, { recursive: true, force: true });
});

describe("verification store", () => {
  it("reads a step saved with the former \"claude\" actor as a command step", async () => {
    await mkdir(verificationDir(wsPath), { recursive: true });
    await writeFile(path.join(verificationDir(wsPath), "old.json"), JSON.stringify({
      id: "old",
      title: "Orders",
      summary: "",
      status: "ready",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      variables: {},
      steps: [{ id: "s1", title: "Serve", actor: "claude", command: "true", status: "pending", revision: 1 }],
      processes: [],
    }));
    const sc = await readScenario(wsPath, "old");
    expect(sc?.steps[0].actor).toBe("command");
  });
});
