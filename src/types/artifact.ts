/**
 * A workspace's `artifacts/` directory, read as a directory.
 *
 * The reviews, research and memo tabs each read the files they know the shape
 * of; this describes the rest — the known-findings ledger, the grounding and
 * validation stores, and whatever an agent decided to write next to them.
 */

export type ArtifactKind = "markdown" | "json" | "text" | "binary";

export interface ArtifactEntry {
  /** Slash-separated, relative to `artifacts/`. */
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  /** Bytes; 0 for a directory. */
  size: number;
  modifiedAt: number;
}

export interface ArtifactListing {
  entries: ArtifactEntry[];
  /** An entry or depth cap was hit, so the listing is incomplete. */
  truncated: boolean;
}

export interface ArtifactFileContent {
  path: string;
  size: number;
  modifiedAt: number;
  kind: ArtifactKind;
  /** Empty for `binary`, and cut at the byte cap when `truncated`. */
  content: string;
  truncated: boolean;
}
