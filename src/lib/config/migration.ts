import fs from "node:fs";
import path from "node:path";
import type { OperationTypeSettings } from "@/types/config";
import {
  KNOWN_CONFIG_KEYS,
  OPERATION_TYPE_NAMES,
  OVERRIDABLE_SETTINGS_KEYS,
} from "./defaults";

const SECTION_NAMES = new Set(["server", "claude", "operations", "chat", "quickAsk"]);

// ---------------------------------------------------------------------------
// Config file generation
// ---------------------------------------------------------------------------

/** Generate default config file content with comments. */
export function generateDefaultConfigContent(): string {
  const lines = [
    "# ai-workspace configuration",
    "# All fields are optional.",
    "",
    "# workspaceRoot: /path/to/ai-workspace",
    "",
    "# server:",
    "#   port: 3741",
    "#   chatPort: 3742",
    "#   disableAccessLog: false   # true silences Next.js dev access logs",
    "",
    "# claude:",
    "#   path: null           # null = auto-detect",
    "#   useCli: true",
    "",
    "# operations:",
    "#   maxConcurrent: 3",
    "#   claudeTimeoutMinutes: 20",
    "#   functionTimeoutMinutes: 3",
    "#   defaultInteractionLevel: mid   # low / mid / high",
    "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates",
    "#   batchSize: 10                  # TODO groups per batch in execute operations",
    "#   model: null                    # null = CLI default (opus / sonnet / haiku)",
    "#   # Built-in step defaults (override via steps.<step-type>.model):",
    "#   #   sonnet: create-pr, coordinate-todos, review-todos, best-of-n-reviewer,",
    "#   #           plan-todo-from-review, discover-constraints, autonomous-gate,",
    "#   #           verify-readme, code-review",
    "#   #   haiku:  collect-reviews, verify-todo, deep-search",
    "#   #   (all others: CLI default)",
    "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
    "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
    "#   #   claudeTimeoutMinutes: 20",
    "#   #   functionTimeoutMinutes: 3",
    "#   #   defaultInteractionLevel: mid",
    "#   #   bestOfN: 0",
    "#   #   batchSize: 10",
    "#   #   model: sonnet",
    "#   #   steps:",
    "#   #     <step-type>:",
    "#   #       model: haiku",
    "",
    "# chat:",
    "#   model: sonnet                  # default model for interactive chat (null = CLI default)",
    "",
    "# quickAsk:",
    "#   model: sonnet                  # default model for quick-ask (null = CLI default)",
    "#   effort: medium                 # effort level (low / medium / high / max, null = CLI default)",
    "#   allowedTools: [Read, Glob, Grep, WebFetch, WebSearch]  # null = no restriction",
    "",
    "# editor: code {path}",
    "# terminal: open -a Terminal {path}",
    "",
  ];
  return lines.join("\n");
}

/**
 * Create the config file with commented-out defaults if it doesn't exist.
 * Returns true if the file was created, false if it already exists.
 */
export function ensureConfigFile(filePath: string): boolean {
  if (fs.existsSync(filePath)) {
    migrateConfigFile(filePath);
    return false;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, generateDefaultConfigContent(), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Config migration
// ---------------------------------------------------------------------------

interface ParsedLine {
  type: "top-key" | "nested-key" | "other";
  key?: string;
  /** Indentation level (number of leading spaces) for nested keys. */
  indent?: number;
  commented: boolean;
}

function parseConfigLine(line: string): ParsedLine {
  const trimmed = line.trimStart();
  if (!trimmed || !trimmed.includes(":")) {
    return { type: "other", commented: false };
  }

  const isCommented = line.startsWith("#");
  // Remove '#' and at most one space after it (the comment marker space)
  const effective = isCommented ? line.replace(/^#\s?/, "") : line;

  // Nested key: starts with 2+ spaces then word then colon
  const nestedMatch = effective.match(/^(\s{2,})([\w-]+)\s*:/);
  if (nestedMatch) {
    return { type: "nested-key", key: nestedMatch[2], indent: nestedMatch[1].length, commented: isCommented };
  }

  // Top-level key: starts with word char at column 0
  const topMatch = effective.match(/^([\w-]+)\s*:/);
  if (topMatch) {
    return { type: "top-key", key: topMatch[1], commented: isCommented };
  }

  return { type: "other", commented: false };
}

/**
 * Find the last line index that belongs to a section (header or nested key).
 * Returns -1 if the section is not found.
 */
function findSectionEnd(lines: string[], sectionName: string): number {
  let inSection = false;
  let lastSectionLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseConfigLine(lines[i]);
    if (parsed.type === "top-key" && parsed.key === sectionName) {
      inSection = true;
      lastSectionLine = i;
    } else if (inSection) {
      if (parsed.type === "nested-key") {
        lastSectionLine = i;
      } else if (parsed.type === "top-key") {
        break; // New top-level key = section ended
      }
    }
  }

  return lastSectionLine;
}

/**
 * Migrate config file content: comment out unknown active keys, add missing
 * known keys as commented-out entries.
 *
 * Pure function — no I/O.
 */
export function migrateConfigContent(content: string): string {
  let lines = content.split("\n");

  // --- Phase 1: Comment out unknown active keys ---
  lines = commentOutUnknownKeys(lines);

  // --- Phase 2: Add missing entries ---
  lines = addMissingEntries(lines);

  // --- Phase 3: Add per-type override hint if operations section exists ---
  lines = addTypeOverrideHint(lines);

  return lines.join("\n");
}

/** Per-type override hint comment markers (current + legacy, used to detect existing hint blocks). */
const TYPE_OVERRIDE_HINT_MARKER = "Built-in step defaults";
const TYPE_OVERRIDE_HINT_MARKER_LEGACY = "Per-operation-type overrides";

const TYPE_OVERRIDE_HINT_LINES = [
  "#   # Built-in step defaults (override via steps.<step-type>.model):",
  "#   #   sonnet: create-pr, coordinate-todos, review-todos, best-of-n-reviewer,",
  "#   #           plan-todo-from-review, discover-constraints, autonomous-gate,",
  "#   #           verify-readme, code-review",
  "#   #   haiku:  collect-reviews, verify-todo, deep-search",
  "#   #   (all others: CLI default)",
  "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
  "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
  "#   #   claudeTimeoutMinutes: 20",
  "#   #   functionTimeoutMinutes: 3",
  "#   #   defaultInteractionLevel: mid",
  "#   #   bestOfN: 0",
  "#   #   batchSize: 10",
  "#   #   model: sonnet",
  "#   #   steps:",
  "#   #     <step-type>:",
  "#   #       model: haiku",
];

/**
 * If the operations section exists but has no (or outdated) per-type override
 * hint comment, insert/replace it at the end of the section.
 */
function addTypeOverrideHint(lines: string[]): string[] {
  // Check if the operations section exists
  const hasOperations = lines.some((line) => {
    const parsed = parseConfigLine(line);
    return parsed.type === "top-key" && parsed.key === "operations";
  });
  if (!hasOperations) return lines;

  const result = [...lines];

  // Find and remove any existing hint block (marker line + consecutive `#   #` lines after it).
  // Check both current and legacy markers to handle config files from older versions.
  for (const marker of [TYPE_OVERRIDE_HINT_MARKER, TYPE_OVERRIDE_HINT_MARKER_LEGACY]) {
    const markerIdx = result.findIndex((line) => line.includes(marker));
    if (markerIdx >= 0) {
      let end = markerIdx + 1;
      while (end < result.length && result[end].startsWith("#   #")) {
        end++;
      }
      // Check if the existing block already matches the desired content
      const existing = result.slice(markerIdx, end);
      if (
        existing.length === TYPE_OVERRIDE_HINT_LINES.length &&
        existing.every((line, i) => line === TYPE_OVERRIDE_HINT_LINES[i])
      ) {
        return lines; // Already up to date
      }
      result.splice(markerIdx, end - markerIdx);
      break; // Only remove one block
    }
  }

  // Find the end of the operations section and insert the hint
  const endLine = findSectionEnd(result, "operations");
  if (endLine < 0) return lines;

  result.splice(endLine + 1, 0, ...TYPE_OVERRIDE_HINT_LINES);
  return result;
}

function commentOutUnknownKeys(lines: string[]): string[] {
  let currentSection: string | null = null;
  let sectionCommentedOut = false;
  // Track operation-type sub-section within "operations" (e.g., "review", "execute")
  let opsSubSection: string | null = null;
  // Track whether we are inside a "steps:" block within an operation-type sub-section.
  // All keys inside "steps:" are arbitrary step type names and should NOT be commented out.
  let inStepsBlock = false;
  let stepsIndent = 0;

  return lines.map((line) => {
    const parsed = parseConfigLine(line);

    if (parsed.type === "top-key") {
      sectionCommentedOut = false;
      opsSubSection = null;
      inStepsBlock = false;
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
      if (!parsed.commented) {
        const isKnown = KNOWN_CONFIG_KEYS.some(
          (k) => k.section === null && k.key === parsed.key!,
        );
        if (!isKnown) {
          // If this is a section-like header (key with no inline value), mark children
          if (/^[\w-]+\s*:\s*$/.test(line)) {
            sectionCommentedOut = true;
          }
          return `# ${line}`;
        }
      }
    } else if (parsed.type === "nested-key") {
      if (!parsed.commented) {
        if (sectionCommentedOut) {
          return `# ${line}`;
        }
        if (currentSection === "operations") {
          // If inside a steps block, allow all keys (arbitrary step type names and their settings)
          if (inStepsBlock && parsed.indent != null && parsed.indent > stepsIndent) {
            return line;
          }
          // Leaving the steps block
          if (inStepsBlock && parsed.indent != null && parsed.indent <= stepsIndent) {
            inStepsBlock = false;
          }

          // Check for operation-type sub-section headers (2-space indent)
          if (parsed.indent === 2 && OPERATION_TYPE_NAMES.has(parsed.key!)) {
            opsSubSection = parsed.key!;
            inStepsBlock = false;
            return line; // Valid sub-section header
          }
          // Check for keys inside an operation-type sub-section (4+ space indent)
          if (opsSubSection && parsed.indent != null && parsed.indent >= 4) {
            // Detect "steps:" header
            if (parsed.key === "steps") {
              inStepsBlock = true;
              stepsIndent = parsed.indent;
              return line;
            }
            if (OVERRIDABLE_SETTINGS_KEYS.has(parsed.key! as keyof OperationTypeSettings)) {
              return line; // Valid overridable setting
            }
            return `# ${line}`; // Unknown key inside sub-section
          }
          // Regular operations nested key (2-space indent, not a sub-section)
          if (parsed.indent === 2) {
            opsSubSection = null; // Left the sub-section
            inStepsBlock = false;
          }
          const isKnown = KNOWN_CONFIG_KEYS.some(
            (k) => k.section === "operations" && k.key === parsed.key!,
          );
          if (!isKnown && !OPERATION_TYPE_NAMES.has(parsed.key!)) {
            return `# ${line}`;
          }
        } else if (currentSection) {
          const isKnown = KNOWN_CONFIG_KEYS.some(
            (k) => k.section === currentSection && k.key === parsed.key!,
          );
          if (!isKnown) return `# ${line}`;
        }
      } else {
        // Track sub-section and steps from commented lines too
        if (currentSection === "operations") {
          if (inStepsBlock && parsed.indent != null && parsed.indent <= stepsIndent) {
            inStepsBlock = false;
          }
          if (parsed.indent === 2) {
            if (OPERATION_TYPE_NAMES.has(parsed.key!)) {
              opsSubSection = parsed.key!;
              inStepsBlock = false;
            } else if (!OVERRIDABLE_SETTINGS_KEYS.has(parsed.key! as keyof OperationTypeSettings)
              && !KNOWN_CONFIG_KEYS.some((k) => k.section === "operations" && k.key === parsed.key!)) {
              opsSubSection = null;
              inStepsBlock = false;
            }
          } else if (opsSubSection && parsed.indent != null && parsed.indent >= 4 && parsed.key === "steps") {
            inStepsBlock = true;
            stepsIndent = parsed.indent;
          }
        }
      }
    }

    // Track section from commented headers too
    if (parsed.type === "top-key" && parsed.commented) {
      opsSubSection = null;
      inStepsBlock = false;
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
    }

    return line;
  });
}

function addMissingEntries(lines: string[]): string[] {
  // Scan for what exists (both active and commented)
  let currentSection: string | null = null;
  const found = new Set<string>();

  for (const line of lines) {
    const parsed = parseConfigLine(line);
    if (parsed.type === "top-key") {
      found.add(parsed.key!);
      if (SECTION_NAMES.has(parsed.key!)) {
        currentSection = parsed.key!;
      } else {
        currentSection = null;
      }
    } else if (parsed.type === "nested-key" && currentSection) {
      // Only track direct children (indent 2), not sub-section children (indent 4+)
      if (parsed.indent === 2) {
        found.add(`${currentSection}.${parsed.key!}`);
      }
    }
  }

  // Determine what's missing
  const missing = KNOWN_CONFIG_KEYS.filter((def) => {
    const id = def.section ? `${def.section}.${def.key}` : def.key;
    return !found.has(id);
  });

  if (missing.length === 0) return lines;

  const result = [...lines];

  // Missing sections (section header itself is missing)
  const missingSectionHeaders = new Set(
    missing
      .filter((m) => m.section === null && SECTION_NAMES.has(m.key))
      .map((m) => m.key),
  );

  // Missing nested entries in EXISTING sections
  const missingInExistingSection = missing.filter(
    (m) => m.section !== null && !missingSectionHeaders.has(m.section) && found.has(m.section),
  );

  // Missing top-level scalar entries
  const missingTopLevel = missing.filter(
    (m) => m.section === null && !SECTION_NAMES.has(m.key),
  );

  // Insert missing nested entries at end of their existing sections
  // Group by section
  const sectionInsertions = new Map<string, string[]>();
  for (const m of missingInExistingSection) {
    if (!sectionInsertions.has(m.section!)) {
      sectionInsertions.set(m.section!, []);
    }
    sectionInsertions.get(m.section!)!.push(m.defaultLine);
  }

  // Find insertion points and apply bottom-to-top
  const insertionPoints: { afterLine: number; linesToInsert: string[] }[] = [];
  for (const [section, insertLines] of sectionInsertions) {
    const endLine = findSectionEnd(result, section);
    if (endLine >= 0) {
      insertionPoints.push({ afterLine: endLine, linesToInsert: insertLines });
    }
  }

  insertionPoints.sort((a, b) => b.afterLine - a.afterLine);
  for (const { afterLine, linesToInsert } of insertionPoints) {
    result.splice(afterLine + 1, 0, ...linesToInsert);
  }

  // Append missing sections and top-level entries at end
  const appendLines: string[] = [];

  // Missing sections (header + all children)
  for (const sectionKey of missingSectionHeaders) {
    const header = KNOWN_CONFIG_KEYS.find(
      (k) => k.key === sectionKey && k.section === null,
    );
    if (header) {
      appendLines.push("");
      appendLines.push(header.defaultLine);
      const children = missing.filter((m) => m.section === sectionKey);
      for (const child of children) {
        appendLines.push(child.defaultLine);
      }
    }
  }

  // Missing top-level scalars
  for (const m of missingTopLevel) {
    appendLines.push(m.defaultLine);
  }

  if (appendLines.length > 0) {
    // Remove trailing empty lines before appending
    while (result.length > 0 && result[result.length - 1] === "") {
      result.pop();
    }
    result.push(...appendLines);
    result.push(""); // trailing newline
  }

  return result;
}

/**
 * Migrate a config file on disk. Returns true if changes were made.
 */
export function migrateConfigFile(filePath: string): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  const migrated = migrateConfigContent(content);
  if (migrated === content) return false;
  fs.writeFileSync(filePath, migrated, "utf-8");
  return true;
}
