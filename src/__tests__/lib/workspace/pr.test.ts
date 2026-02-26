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

  it("returns null when no template exists", () => {
    expect(readPRTemplate(tmpDir)).toBeNull();
  });

  it("reads .github/PULL_REQUEST_TEMPLATE.md", () => {
    const dir = path.join(tmpDir, ".github");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "## PR\ntemplate content");

    expect(readPRTemplate(tmpDir)).toBe("## PR\ntemplate content");
  });

  it("reads .github/pull_request_template.md (lowercase)", () => {
    const dir = path.join(tmpDir, ".github");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pull_request_template.md"), "lowercase template");

    expect(readPRTemplate(tmpDir)).toBe("lowercase template");
  });

  it("reads from .github/PULL_REQUEST_TEMPLATE/default.md", () => {
    const dir = path.join(tmpDir, ".github", "PULL_REQUEST_TEMPLATE");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "default.md"), "default template");

    expect(readPRTemplate(tmpDir)).toBe("default template");
  });

  it("reads from docs/ directory", () => {
    const dir = path.join(tmpDir, "docs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "docs template");

    expect(readPRTemplate(tmpDir)).toBe("docs template");
  });

  it("reads from repo root", () => {
    fs.writeFileSync(path.join(tmpDir, "PULL_REQUEST_TEMPLATE.md"), "root template");

    expect(readPRTemplate(tmpDir)).toBe("root template");
  });

  it("prioritizes .github/ over docs/ and root", () => {
    // Create templates in all locations
    const githubDir = path.join(tmpDir, ".github");
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, "PULL_REQUEST_TEMPLATE.md"), "github template");

    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "PULL_REQUEST_TEMPLATE.md"), "docs template");

    fs.writeFileSync(path.join(tmpDir, "PULL_REQUEST_TEMPLATE.md"), "root template");

    expect(readPRTemplate(tmpDir)).toBe("github template");
  });

  it("prioritizes .github/PULL_REQUEST_TEMPLATE.md over subdirectory default.md", () => {
    const githubDir = path.join(tmpDir, ".github");
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, "PULL_REQUEST_TEMPLATE.md"), "top-level");

    const subDir = path.join(githubDir, "PULL_REQUEST_TEMPLATE");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "default.md"), "subdirectory");

    expect(readPRTemplate(tmpDir)).toBe("top-level");
  });

  it("falls back to subdirectory default.md when no top-level template", () => {
    const dir = path.join(tmpDir, ".github", "PULL_REQUEST_TEMPLATE");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "default.md"), "subdirectory default");

    expect(readPRTemplate(tmpDir)).toBe("subdirectory default");
  });
});
