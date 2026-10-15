import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetConfig, _resetWorkspaceRoot, setWorkspaceRoot } from "@/lib/config";
import { sh as exec } from "../../fixtures/sh";
import {
  locateRepoGuidanceCache,
  parseRepoGuidance,
  readRepoGuidance,
  readRepoGuidanceCache,
  repoGuidancePath,
  writeRepoGuidanceCache,
} from "@/lib/workspace/repo-guidance";

const GUIDANCE = `# Repository guidance: web

## Implementation

- \`CLAUDE.md\` — error wrapping with \`errors.Join\`; table-driven tests
  for every handler.

## Review

- \`.claude/skills/pr-review/references/lens-prompts.md\` — the four review lenses.
`;

describe("parseRepoGuidance", () => {
  it("splits the two sections without letting one bleed into the other", () => {
    const { implementation, review } = parseRepoGuidance(GUIDANCE);
    expect(implementation).toBe(
      "- `CLAUDE.md` — error wrapping with `errors.Join`; table-driven tests\n  for every handler.",
    );
    expect(review).toBe("- `.claude/skills/pr-review/references/lens-prompts.md` — the four review lenses.");
  });

  it("drops the placeholder prose an agent writes when it found nothing", () => {
    const { implementation, review } = parseRepoGuidance(
      "## Implementation\n\nNone found.\n\n## Review\n\n_No review guidance._\n",
    );
    expect(implementation).toBe("");
    expect(review).toBe("");
  });

  it("reads a missing section as empty", () => {
    expect(parseRepoGuidance("## Review\n\n- `a.md` — x\n").implementation).toBe("");
  });
});

describe("readRepoGuidance", () => {
  let wsPath: string;
  beforeEach(() => {
    wsPath = fs.mkdtempSync(path.join("/tmp", "aiw-guidance-ws-"));
  });
  afterEach(() => {
    fs.rmSync(wsPath, { recursive: true, force: true });
  });

  it("reads the repository's artifact", async () => {
    const file = repoGuidancePath(wsPath, "web");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, GUIDANCE);
    expect((await readRepoGuidance(wsPath, "web"))?.review).toContain("lens-prompts.md");
  });

  it("is null when discovery never wrote one", async () => {
    expect(await readRepoGuidance(wsPath, "web")).toBeNull();
  });
});

/**
 * Real clones and worktrees, for the same reason as the constraints cache: the
 * key comes from git trees and the location from the clone.
 */
describe("repo guidance cache", { timeout: 30_000 }, () => {
  let root: string;
  let clone: string;

  function git(cwd: string, cmd: string) {
    exec(`git -C "${cwd}" ${cmd}`);
  }

  function commit(files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(clone, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(clone, "add -A");
    git(clone, "commit -q -m change");
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join("/tmp", "aiw-guidance-cache-"));
    clone = path.join(root, "repositories", "github.com", "acme", "web");
    fs.mkdirSync(clone, { recursive: true });
    exec(`git init -q -b main "${clone}"`);
    git(clone, "config user.email t@t.t");
    git(clone, "config user.name t");
    git(clone, "config commit.gpgsign false");
    commit({
      "CLAUDE.md": "# web\n",
      ".claude/skills/pr-review/SKILL.md": "---\nname: pr-review\n---\n",
      "src/index.ts": "export {};\n",
    });
    fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
    setWorkspaceRoot(root);
    _resetConfig();
  });

  afterEach(() => {
    _resetConfig();
    _resetWorkspaceRoot();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function cacheThenLookUp(change?: Record<string, string>) {
    const first = (await locateRepoGuidanceCache(clone))!;
    await writeRepoGuidanceCache(first, GUIDANCE);
    if (change) commit(change);
    return await readRepoGuidanceCache((await locateRepoGuidanceCache(clone))!);
  }

  it("serves the guidance back while nothing it was drawn from moved", async () => {
    expect(await cacheThenLookUp({ "src/index.ts": "export const x = 1;\n" })).toBe(GUIDANCE);
  });

  it("misses once a file deep inside a skill changes", async () => {
    expect(
      await cacheThenLookUp({ ".claude/skills/pr-review/references/lens-prompts.md": "lenses\n" }),
    ).toBeNull();
  });

  it("misses once the root CLAUDE.md changes", async () => {
    expect(await cacheThenLookUp({ "CLAUDE.md": "# web\n\nWrap every error.\n" })).toBeNull();
  });

  it("keeps its entry apart from the constraints cache of the same clone", async () => {
    const entry = (await locateRepoGuidanceCache(clone))!;
    expect(entry.file).toBe(path.join(root, ".ai-workspace", "repo-guidance", "github.com", "acme", "web.md"));
  });
});
