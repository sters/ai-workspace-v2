/**
 * Unified-diff parsing shared by the History and Changes tabs. Pure, so it runs
 * in the browser.
 */

export interface FileDiffEntry {
  filename: string;
  content: string;
  additions: number;
  deletions: number;
}

export function parseDiffByFile(rawDiff: string): FileDiffEntry[] {
  const chunks = rawDiff.split(/^(?=diff --git )/m);
  const files: FileDiffEntry[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    let filename = "unknown";
    const plusMatch = trimmed.match(/^\+\+\+ b\/(.+)$/m);
    if (plusMatch) {
      filename = plusMatch[1];
    } else {
      const headerMatch = trimmed.match(/^diff --git a\/(.+?) b\//);
      if (headerMatch) filename = headerMatch[1];
    }

    let additions = 0;
    let deletions = 0;
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ filename, content: trimmed, additions, deletions });
  }

  return files;
}

/** A file's diff from its first hunk on: the header lines say nothing a reader needs. */
export function hunkBody(content: string): string {
  const lines = content.replace(/\n$/, "").split("\n");
  const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
  return hunkStart >= 0 ? lines.slice(hunkStart).join("\n") : content;
}

export interface DiffLine {
  kind: "hunk" | "context" | "add" | "del" | "other";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Every line of a hunk body, numbered on the side(s) of the file it belongs to. */
export function mapHunkLines(body: string): DiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  return body.split("\n").map((text): DiffLine => {
    const header = text.match(HUNK_HEADER);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      return { kind: "hunk", text, oldLine: null, newLine: null };
    }
    if (text.startsWith("+")) return { kind: "add", text, oldLine: null, newLine: newLine++ };
    if (text.startsWith("-")) return { kind: "del", text, oldLine: oldLine++, newLine: null };
    // `\ No newline at end of file` belongs to neither side.
    if (text.startsWith("\\")) return { kind: "other", text, oldLine: null, newLine: null };
    return { kind: "context", text, oldLine: oldLine++, newLine: newLine++ };
  });
}

export interface LineRangeDescription {
  /** First and last line on each side of the file; `null` when the side has none. */
  oldRange: [number, number] | null;
  newRange: [number, number] | null;
  /** The selected diff lines verbatim, markers included. */
  text: string;
}

/** What editor lines `startLine..endLine` (1-based, inclusive) cover in the file. */
export function describeLineRange(
  lines: DiffLine[],
  startLine: number,
  endLine: number,
): LineRangeDescription {
  const picked = lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine));
  const span = (values: (number | null)[]): [number, number] | null => {
    const present = values.filter((v): v is number => v !== null);
    return present.length > 0 ? [present[0], present[present.length - 1]] : null;
  };
  return {
    oldRange: span(picked.map((l) => l.oldLine)),
    newRange: span(picked.map((l) => l.newLine)),
    text: picked.map((l) => l.text).join("\n"),
  };
}
