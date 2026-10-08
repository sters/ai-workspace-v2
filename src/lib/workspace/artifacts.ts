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

import { pathExists } from "@/lib/fs";
import type { Dirent, Stats } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
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

async function realPathOrSelf(target: string): Promise<string> {
  try {
    return await realpath(target);
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
export async function resolveArtifactPath(wsPath: string, relPath: string): Promise<string | null> {
  if (!relPath || path.isAbsolute(relPath)) return null;

  const normalized = path.normalize(relPath);
  if (normalized.split(/[\\/]/).some((segment) => segment === "..")) return null;

  const dir = getArtifactsDir(wsPath);
  const full = path.resolve(dir, normalized);
  if (!isInside(dir, full)) return null;

  if ((await pathExists(full)) && !isInside(await realPathOrSelf(dir), await realPathOrSelf(full))) {
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
export async function listArtifacts(
  wsPath: string,
  opts: { maxEntries?: number; maxDepth?: number } = {},
): Promise<ArtifactListing> {
  const maxEntries = opts.maxEntries ?? ARTIFACT_MAX_ENTRIES;
  const maxDepth = opts.maxDepth ?? ARTIFACT_MAX_DEPTH;
  const root = getArtifactsDir(wsPath);
  const entries: ArtifactEntry[] = [];
  let truncated = false;

  const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
    if (depth >= maxDepth) {
      truncated = true;
      return;
    }

    let dirents: Dirent[];
    try {
      dirents = await readdir(dir, { withFileTypes: true });
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

      let st: Stats;
      try {
        st = await stat(full);
      } catch {
        continue;
      }

      const isDir = dirent.isDirectory();
      entries.push({
        path: rel,
        name: dirent.name,
        depth,
        isDir,
        size: isDir ? 0 : st.size,
        modifiedAt: st.mtimeMs,
      });

      if (isDir) await walk(full, rel, depth + 1);
    }
  };

  if (!(await pathExists(root))) return { entries: [], truncated: false };
  await walk(root, "", 0);

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
export async function readArtifact(wsPath: string, relPath: string): Promise<ArtifactFileContent | null> {
  const full = await resolveArtifactPath(wsPath, relPath);
  if (!full) return null;

  let st: Stats;
  try {
    st = await stat(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  const readLength = Math.min(st.size, ARTIFACT_MAX_BYTES);
  let buffer = Buffer.alloc(0);
  if (readLength > 0) {
    buffer = Buffer.alloc(readLength);
    let file;
    try {
      file = await open(full, "r");
    } catch {
      return null;
    }
    try {
      await file.read(buffer, 0, readLength, 0);
    } catch {
      return null;
    } finally {
      await file.close();
    }
  }

  const isBinary = buffer.includes(0);

  return {
    path: relPath,
    size: st.size,
    modifiedAt: st.mtimeMs,
    kind: isBinary ? "binary" : kindFromPath(relPath),
    content: isBinary ? "" : buffer.toString("utf-8"),
    truncated: st.size > readLength,
  };
}
