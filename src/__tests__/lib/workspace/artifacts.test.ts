import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ARTIFACT_MAX_BYTES } from "@/lib/constants";
import {
  getArtifactsDir,
  listArtifacts,
  readArtifact,
  resolveArtifactPath,
} from "@/lib/workspace/artifacts";

let wsPath: string;
let artifactsDir: string;

function write(relPath: string, content: string | Buffer) {
  const full = path.join(artifactsDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  wsPath = fs.mkdtempSync(path.join("/tmp", "aiw-artifacts-"));
  artifactsDir = path.join(wsPath, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(wsPath, { recursive: true, force: true });
});

describe("getArtifactsDir", () => {
  it("is the artifacts directory of the workspace", () => {
    expect(getArtifactsDir("/ws/feature-x")).toBe("/ws/feature-x/artifacts");
  });
});

describe("listArtifacts", () => {
  it("reports an empty listing when the workspace has no artifacts directory", () => {
    fs.rmSync(artifactsDir, { recursive: true });
    expect(listArtifacts(wsPath)).toEqual({ entries: [], truncated: false });
  });

  it("walks nested directories, parents before children", () => {
    write("known-findings.md", "# findings");
    write("reviews/20260101-000000/SUMMARY.md", "# summary");

    const { entries } = listArtifacts(wsPath);

    expect(entries.map((e) => e.path)).toEqual([
      "reviews",
      "reviews/20260101-000000",
      "reviews/20260101-000000/SUMMARY.md",
      "known-findings.md",
    ]);
    expect(entries.map((e) => e.depth)).toEqual([0, 1, 2, 0]);
  });

  it("orders directories before files and sorts each group by name", () => {
    write("b.md", "b");
    write("a.md", "a");
    write("zeta/x.md", "x");

    const { entries } = listArtifacts(wsPath);

    expect(entries.map((e) => e.path)).toEqual(["zeta", "zeta/x.md", "a.md", "b.md"]);
  });

  it("carries each file's size and modification time", () => {
    write("notes.md", "hello");

    const file = listArtifacts(wsPath).entries.find((e) => e.path === "notes.md");

    expect(file).toMatchObject({ name: "notes.md", isDir: false, size: 5 });
    expect(file!.modifiedAt).toBeGreaterThan(0);
  });

  it("omits the .gitkeep that workspace setup writes", () => {
    write(".gitkeep", "");
    write("real.md", "x");

    expect(listArtifacts(wsPath).entries.map((e) => e.path)).toEqual(["real.md"]);
  });

  it("does not follow symlinks out of the artifacts directory", () => {
    fs.writeFileSync(path.join(wsPath, "README.md"), "outside");
    fs.symlinkSync(path.join(wsPath, "README.md"), path.join(artifactsDir, "escape.md"));
    fs.symlinkSync(wsPath, path.join(artifactsDir, "escape-dir"));

    expect(listArtifacts(wsPath).entries).toEqual([]);
  });

  it("stops at the entry cap and says so", () => {
    for (let i = 0; i < 12; i++) write(`f${i}.md`, "x");

    const listing = listArtifacts(wsPath, { maxEntries: 5 });

    expect(listing.entries).toHaveLength(5);
    expect(listing.truncated).toBe(true);
  });

  it("stops descending at the depth cap", () => {
    write("a/b/c/deep.md", "x");

    const { entries } = listArtifacts(wsPath, { maxDepth: 2 });

    expect(entries.map((e) => e.path)).toEqual(["a", "a/b"]);
  });
});

describe("resolveArtifactPath", () => {
  it("resolves a path inside the artifacts directory", () => {
    expect(resolveArtifactPath(wsPath, "reviews/SUMMARY.md")).toBe(
      path.join(artifactsDir, "reviews/SUMMARY.md"),
    );
  });

  it("refuses a parent-directory escape", () => {
    expect(resolveArtifactPath(wsPath, "../README.md")).toBeNull();
    expect(resolveArtifactPath(wsPath, "reviews/../../README.md")).toBeNull();
  });

  it("refuses an absolute path", () => {
    expect(resolveArtifactPath(wsPath, "/etc/passwd")).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(resolveArtifactPath(wsPath, "")).toBeNull();
  });

  it("refuses a path that reaches outside through a symlink", () => {
    fs.writeFileSync(path.join(wsPath, "README.md"), "outside");
    fs.symlinkSync(path.join(wsPath, "README.md"), path.join(artifactsDir, "escape.md"));

    expect(resolveArtifactPath(wsPath, "escape.md")).toBeNull();
  });
});

describe("readArtifact", () => {
  it("reads a markdown file", () => {
    write("known-findings.md", "# Known Findings\n");

    expect(readArtifact(wsPath, "known-findings.md")).toMatchObject({
      path: "known-findings.md",
      kind: "markdown",
      content: "# Known Findings\n",
      size: 17,
      truncated: false,
    });
  });

  it("reads a json file as json", () => {
    write("pr-validations.json", '{"a":1}');

    expect(readArtifact(wsPath, "pr-validations.json")?.kind).toBe("json");
  });

  it("reads an unknown extension as plain text", () => {
    write("notes.txt", "plain");

    expect(readArtifact(wsPath, "notes.txt")?.kind).toBe("text");
  });

  it("reports a file holding a null byte as binary, without its content", () => {
    write("shot.png", Buffer.from([0x89, 0x50, 0x00, 0x01]));

    expect(readArtifact(wsPath, "shot.png")).toMatchObject({
      kind: "binary",
      content: "",
    });
  });

  it("truncates a file past the byte cap", () => {
    write("huge.md", "x".repeat(ARTIFACT_MAX_BYTES + 100));

    const file = readArtifact(wsPath, "huge.md");

    expect(file?.content).toHaveLength(ARTIFACT_MAX_BYTES);
    expect(file?.truncated).toBe(true);
    expect(file?.size).toBe(ARTIFACT_MAX_BYTES + 100);
  });

  it("reads an empty file as empty rather than failing", () => {
    write("empty.md", "");

    expect(readArtifact(wsPath, "empty.md")).toMatchObject({ content: "", size: 0 });
  });

  it("returns null for a missing file", () => {
    expect(readArtifact(wsPath, "nope.md")).toBeNull();
  });

  it("returns null for a directory", () => {
    write("reviews/SUMMARY.md", "x");

    expect(readArtifact(wsPath, "reviews")).toBeNull();
  });

  it("returns null for an escaping path", () => {
    fs.writeFileSync(path.join(wsPath, "README.md"), "outside");

    expect(readArtifact(wsPath, "../README.md")).toBeNull();
  });
});
