import { describe, expect, it } from "vitest";
import { migrateConfigContent, generateDefaultConfigContent } from "@/lib/config/migration";
import { CONFIG_DEFAULTS, KNOWN_CONFIG_KEYS } from "@/lib/config/defaults";

// The generated file documents each default as a commented-out line, and the
// migrator carries its own copy in KNOWN_CONFIG_KEYS. Both are hand-maintained
// strings, so a changed default silently leaves two copies stating the old one.
describe("migration: documented defaults match the real defaults", () => {
  const scalars = Object.entries(CONFIG_DEFAULTS.operations).filter(
    ([, v]) => typeof v === "number" || typeof v === "boolean",
  );

  it.each(scalars)("operations.%s is documented as %s in the generated config", (key, value) => {
    const line = generateDefaultConfigContent()
      .split("\n")
      .find((l) => new RegExp(`^#\\s+${key}:`).test(l));
    expect(line, `no generated line for operations.${key}`).toBeDefined();
    expect(line).toMatch(new RegExp(`^#\\s+${key}: ${value}\\b`));
  });

  it.each(scalars)("operations.%s's migrator hint states %s", (key, value) => {
    const def = KNOWN_CONFIG_KEYS.find((k) => k.section === "operations" && k.key === key);
    expect(def, `operations.${key} is missing from KNOWN_CONFIG_KEYS`).toBeDefined();
    expect(def!.defaultLine).toMatch(new RegExp(`^#\\s+${key}: ${value}\\b`));
  });
});

describe("migration: model support", () => {
  it("model is valid in operations section (not commented out)", () => {
    const input = [
      "operations:",
      "  model: sonnet",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    // The active "  model: sonnet" line (2-space indent, no comment) should survive
    const lines = result.split("\n");
    const activeLine = lines.find((l) => /^\s{2}model: sonnet$/.test(l));
    expect(activeLine).toBeDefined();
  });

  it("steps is valid in operation type sub-section", () => {
    const input = [
      "operations:",
      "  review:",
      "    model: haiku",
      "    steps:",
      "      code-review:",
      "        model: sonnet",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("    steps:");
    expect(result).toContain("      code-review:");
    expect(result).toContain("        model: sonnet");
  });

  it("arbitrary step type names inside steps block are not commented out", () => {
    const input = [
      "operations:",
      "  execute:",
      "    model: opus",
      "    steps:",
      "      my-custom-step:",
      "        model: haiku",
      "      another-step:",
      "        model: sonnet",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("      my-custom-step:");
    expect(result).toContain("        model: haiku");
    expect(result).toContain("      another-step:");
    expect(result).toContain("        model: sonnet");
  });

  it("unknown keys outside steps block are still commented out", () => {
    const input = [
      "operations:",
      "  review:",
      "    model: haiku",
      "    unknownKey: true",
      "    steps:",
      "      code-review:",
      "        model: sonnet",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    // unknownKey is outside steps, should be commented out
    expect(result).toContain("#     unknownKey: true");
    // steps content should be preserved
    expect(result).toContain("      code-review:");
    expect(result).toContain("        model: sonnet");
  });

  it("model appears in generated default config", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("#   model: null");
  });

  it("disableAccessLog appears in generated default config", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("#   disableAccessLog: false");
  });

  it("suggest.enabled appears in generated default config", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("# suggest:");
    expect(content).toContain("#   enabled: true");
  });

  it("adds suggest section when missing", () => {
    const input = [
      "operations:",
      "  bestOfN: 3",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("# suggest:");
    expect(result).toContain("#   enabled: true");
  });

  it("preserves user-set suggest.enabled = false", () => {
    const input = [
      "suggest:",
      "  enabled: false",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("suggest:");
    expect(result).toContain("  enabled: false");
  });

  it("adds disableAccessLog to old server section missing it", () => {
    const input = [
      "server:",
      "  port: 3741",
      "  chatPort: 3742",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("#   disableAccessLog");
  });

  it("type override hints include model, effort and steps", () => {
    const input = [
      "operations:",
      "  maxConcurrent: 3",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("#   #   model: sonnet");
    expect(result).toContain("#   #   effort: high");
    expect(result).toContain("#   #   steps:");
    expect(result).toContain("#   #     <step-type>:");
    expect(result).toContain("#   #       model: haiku");
    expect(result).toContain("#   #       effort: low");
  });

  it("documents the four rungs of the model+effort ladder", () => {
    const result = migrateConfigContent("operations:\n  maxConcurrent: 3\n");
    expect(result).toContain("#   # Built-in step defaults");
    expect(result).toContain("four rungs");
    expect(result).toMatch(/# {3}# {3}opus \/ high {3}—/);
    expect(result).toMatch(/# {3}# {3}opus \/ medium —/);
    expect(result).toMatch(/# {3}# {3}opus \/ low {4}—/);
    expect(result).toMatch(/# {3}# {3}sonnet \/ low {2}—/);
    // A fifth rung in the docs would mean the ladder drifted from the code.
    expect(result).not.toMatch(/sonnet \/ (medium|high)/);
    // xhigh/max are config-only escape hatches, never advertised as defaults.
    expect(result).not.toMatch(/opus \/ (xhigh|max)/);
    // The haiku tier is gone from the defaults entirely.
    expect(result).not.toMatch(/# {3}# {3}haiku/);
  });

  it("lists each step under exactly one rung", () => {
    const result = migrateConfigContent("operations:\n  maxConcurrent: 3\n");
    const rungLines = result.split("\n");
    const topRung = rungLines.findIndex((l) => l.includes("opus / high"));
    const nextRung = rungLines.findIndex((l) => l.includes("opus / medium"));
    const topBlock = rungLines.slice(topRung, nextRung).join("\n");
    // plan-todo earns the top rung; the mechanical steps must not appear there.
    expect(topBlock).toContain("plan-todo");
    expect(topBlock).not.toContain("collect-reviews");
    expect(topBlock).not.toContain("verify-todo");
    // code-review sits a rung down by budget, not by shape — see model.ts.
    expect(topBlock).not.toContain("code-review");
  });
});

describe("migration: old config upgrade", () => {
  it("adds model line to old operations section missing it", () => {
    const input = [
      "operations:",
      "  maxConcurrent: 3",
      "  claudeTimeoutMinutes: 20",
      "  functionTimeoutMinutes: 3",
      "  defaultInteractionLevel: mid",
      "  bestOfN: 0",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    // model should be added as a commented-out entry
    expect(result).toContain("#   model:");
  });

  it.each([
    {
      name: "pre-model hint block",
      oldHint: [
        "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
        "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
        "#   #   claudeTimeoutMinutes: 20",
        "#   #   functionTimeoutMinutes: 3",
        "#   #   defaultInteractionLevel: mid",
        "#   #   bestOfN: 0",
      ],
    },
    {
      name: "pre-effort hint block",
      oldHint: [
        "#   # Built-in step defaults (override via steps.<step-type>.model):",
        "#   #   sonnet: create-pr, coordinate-todos, review-todos, best-of-n-reviewer,",
        "#   #           plan-todo-from-review, discover-constraints, autonomous-gate,",
        "#   #           verify-readme, code-review",
        "#   #   haiku:  collect-reviews, verify-todo, deep-search",
        "#   #   (all others: CLI default)",
        "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
        "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
        "#   #   model: sonnet",
        "#   #   steps:",
        "#   #     <step-type>:",
        "#   #       model: haiku",
      ],
    },
  ])("replaces the $name with the current hint block", ({ oldHint }) => {
    const input = [
      "operations:",
      "  bestOfN: 0",
      ...oldHint,
      "",
      "editor: code {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    // New hint lines should be present
    expect(result).toContain("#   # Built-in step defaults");
    expect(result).toContain("four rungs");
    expect(result).toContain("#   #   model: sonnet");
    expect(result).toContain("#   #   effort: high");
    expect(result).toContain("#   #       effort: low");
    // Exactly one hint block survives (the stale one is removed, not duplicated)
    const lines = result.split("\n");
    expect(lines.filter((l) => l.includes("Per-operation-type overrides"))).toHaveLength(1);
    // The migrated block must match the freshly generated one exactly. Asserting
    // equality rather than a line count keeps this from needing an edit every
    // time a step moves between rungs.
    const hintBlock = (content: string) => {
      const ls = content.split("\n");
      const start = ls.findIndex((l) => l.includes("Built-in step defaults"));
      let end = start + 1;
      while (end < ls.length && ls[end].startsWith("#   #")) end++;
      return ls.slice(start, end);
    };
    expect(hintBlock(result).length).toBeGreaterThan(1);
    expect(hintBlock(result)).toEqual(hintBlock(generateDefaultConfigContent()));
  });

  it("is idempotent: migrating generated default content is a no-op", () => {
    const content = generateDefaultConfigContent();
    expect(migrateConfigContent(content)).toBe(content);
  });

  it("is idempotent: migrating already-migrated content is a no-op", () => {
    const oldInput = [
      "operations:",
      "  bestOfN: 0",
      "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   bestOfN: 0",
      "",
      "editor: code {path}",
      "",
    ].join("\n");
    const firstMigration = migrateConfigContent(oldInput);
    const secondMigration = migrateConfigContent(firstMigration);
    expect(secondMigration).toBe(firstMigration);
  });

  it("adds model line to commented-out operations section", () => {
    const input = [
      "# operations:",
      "#   maxConcurrent: 3",
      "#   bestOfN: 0",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    // model should be added within the commented operations section
    expect(result).toContain("#   model:");
  });

  it("full old config migrates to include model and new hints", () => {
    // Simulates an old config.yml that was generated before model/steps support
    const oldConfig = [
      "# ai-workspace configuration",
      "# All fields are optional.",
      "",
      "# workspaceRoot: /path/to/ai-workspace",
      "",
      "# server:",
      "#   port: 3741",
      "#   chatPort: 3742",
      "",
      "# claude:",
      "#   path: null           # null = auto-detect",
      "",
      "# operations:",
      "#   maxConcurrent: 3",
      "#   claudeTimeoutMinutes: 20",
      "#   functionTimeoutMinutes: 3",
      "#   defaultInteractionLevel: mid   # low / mid / high",
      "#   bestOfN: 0                     # 0 = disabled, 2-5 = parallel candidates",
      "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   bestOfN: 0",
      "",
      "# editor: code {path}",
      "# terminal: open -a Terminal {path}",
      "",
    ].join("\n");
    const result = migrateConfigContent(oldConfig);

    // model line should be added in operations section
    expect(result).toContain("#   model:");
    // New hint lines should be present
    expect(result).toContain("#   #   model: sonnet");
    expect(result).toContain("#   #   steps:");

    // Should be idempotent after migration
    expect(migrateConfigContent(result)).toBe(result);
  });
});
