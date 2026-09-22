/**
 * Read-only access to a workspace's `artifacts/` directory.
 *
 * Reviews, research reports and the memo have their own tabs, which read the
 * files they know the shape of. This reads the directory as a directory, so a
 * file no tab was written for — the known-findings ledger, a grounding store, a
 * note an agent decided to write — is still reachable.
 *
 * Every path arrives from a query string, so `resolveArtifactPath` is the only
 * way in: it refuses anything that lands outside `artifacts/`, symlinks
 * included, and the walk never follows one out either.
 */

import fs from "node:fs";
import path from "node:path";
import { ARTIFACT_MAX_BYTES } from "@/lib/constants";
import type {
  ArtifactEntry,
  ArtifactFileContent,
  ArtifactKind,
  ArtifactListing,
} from "@/types/artifact";

export const ARTIFACTS_DIR_NAME = "artifacts";

export const ARTIFACT_MAX_ENTRIES = 5000;
export const ARTIFACT_MAX_DEPTH = 10;

/** Written by workspace setup to keep the directory in git; it is not an artifact. */
const SKIPPED_NAMES = new Set([".gitkeep"]);

export function getArtifactsDir(wsPath: string): string {
  return path.join(wsPath, ARTIFACTS_DIR_NAME);
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realPathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * The absolute path of `relPath` inside the workspace's artifacts directory, or
 * `null` when it does not name something in there.
 *
 * The lexical check rejects `..` and absolute paths; the realpath check is what
 * catches a symlink pointing out of the directory, and it compares resolved
 * paths on both sides because the workspace root may itself sit behind one
 * (`/tmp` on macOS).
 */
export function resolveArtifactPath(wsPath: string, relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath)) return null;

  const normalized = path.normalize(relPath);
  if (normalized.split(/[\\/]/).some((segment) => segment === "..")) return null;

  const dir = getArtifactsDir(wsPath);
  const full = path.resolve(dir, normalized);
  if (!isInside(dir, full)) return null;

  if (fs.existsSync(full) && !isInside(realPathOrSelf(dir), realPathOrSelf(full))) {
    return null;
  }

  return full;
}

function kindFromPath(relPath: string): Exclude<ArtifactKind, "binary"> {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".json") return "json";
  return "text";
}

/**
 * Every file and directory under `artifacts/`, parents before their children and
 * directories before files, so a caller can render the tree by walking the array
 * once.
 */
export function listArtifacts(
  wsPath: string,
  opts: { maxEntries?: number; maxDepth?: number } = {},
): ArtifactListing {
  const maxEntries = opts.maxEntries ?? ARTIFACT_MAX_ENTRIES;
  const maxDepth = opts.maxDepth ?? ARTIFACT_MAX_DEPTH;
  const root = getArtifactsDir(wsPath);
  const entries: ArtifactEntry[] = [];
  let truncated = false;

  const walk = (dir: string, relDir: string, depth: number) => {
    if (depth >= maxDepth) {
      truncated = true;
      return;
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const visible = dirents
      .filter((d) => !SKIPPED_NAMES.has(d.name) && !d.isSymbolicLink())
      .filter((d) => d.isDirectory() || d.isFile())
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory()
          ? a.name.localeCompare(b.name)
          : a.isDirectory()
            ? -1
            : 1,
      );

    for (const dirent of visible) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }

      const full = path.join(dir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      const isDir = dirent.isDirectory();
      entries.push({
        path: rel,
        name: dirent.name,
        depth,
        isDir,
        size: isDir ? 0 : stat.size,
        modifiedAt: stat.mtimeMs,
      });

      if (isDir) walk(full, rel, depth + 1);
    }
  };

  if (!fs.existsSync(root)) return { entries: [], truncated: false };
  walk(root, "", 0);

  return { entries, truncated };
}

/**
 * One artifact's content, or `null` when `relPath` does not name a readable file
 * inside the artifacts directory.
 *
 * The read is bounded before it happens, and a null byte in what came back marks
 * the file binary — an agent can write anything in here, and a megabyte of PNG
 * rendered as text is worse than saying it is a PNG.
 */
export function readArtifact(wsPath: string, relPath: string): ArtifactFileContent | null {
  const full = resolveArtifactPath(wsPath, relPath);
  if (!full) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const readLength = Math.min(stat.size, ARTIFACT_MAX_BYTES);
  let buffer = Buffer.alloc(0);
  if (readLength > 0) {
    buffer = Buffer.alloc(readLength);
    let fd: number;
    try {
      fd = fs.openSync(full, "r");
    } catch {
      return null;
    }
    try {
      fs.readSync(fd, buffer, 0, readLength, 0);
    } catch {
      return null;
    } finally {
      fs.closeSync(fd);
    }
  }

  const isBinary = buffer.includes(0);

  return {
    path: relPath,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    kind: isBinary ? "binary" : kindFromPath(relPath),
    content: isBinary ? "" : buffer.toString("utf-8"),
    truncated: stat.size > readLength,
  };
}
