import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPRTemplate } from "@/lib/workspace/pr";

describe("readPRTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join("/tmp", "pr-template-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no template exists", async () => {
    expect(await readPRTemplate(tmpDir)).toBeNull();
  });

  it("reads .github/PULL_REQUEST_TEMPLATE.md", async () => {
    const dir = path.join(tmpDir, ".github");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "## PR\ntemplate content");

    expect(await readPRTemplate(tmpDir)).toBe("## PR\ntemplate content");
  });

  it("reads .github/pull_request_template.md (lowercase)", async () => {
    const dir = path.join(tmpDir, ".github");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pull_request_template.md"), "lowercase template");

    expect(await readPRTemplate(tmpDir)).toBe("lowercase template");
  });

  it("reads from .github/PULL_REQUEST_TEMPLATE/default.md", async () => {
    const dir = path.join(tmpDir, ".github", "PULL_REQUEST_TEMPLATE");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "default.md"), "default template");

    expect(await readPRTemplate(tmpDir)).toBe("default template");
  });

  it("reads from docs/ directory", async () => {
    const dir = path.join(tmpDir, "docs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "docs template");

    expect(await readPRTemplate(tmpDir)).toBe("docs template");
  });

  it("reads from repo root", async () => {
    fs.writeFileSync(path.join(tmpDir, "PULL_REQUEST_TEMPLATE.md"), "root template");

    expect(await readPRTemplate(tmpDir)).toBe("root template");
  });

  it("prioritizes .github/ over docs/ and root", async () => {
    // Create templates in all locations
    const githubDir = path.join(tmpDir, ".github");
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, "PULL_REQUEST_TEMPLATE.md"), "github template");

    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "PULL_REQUEST_TEMPLATE.md"), "docs template");

    fs.writeFileSync(path.join(tmpDir, "PULL_REQUEST_TEMPLATE.md"), "root template");

    expect(await readPRTemplate(tmpDir)).toBe("github template");
  });

  it("prioritizes .github/PULL_REQUEST_TEMPLATE.md over subdirectory default.md", async () => {
    const githubDir = path.join(tmpDir, ".github");
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, "PULL_REQUEST_TEMPLATE.md"), "top-level");

    const subDir = path.join(githubDir, "PULL_REQUEST_TEMPLATE");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "default.md"), "subdirectory");

    expect(await readPRTemplate(tmpDir)).toBe("top-level");
  });
});
