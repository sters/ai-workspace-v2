import { describe, expect, it } from "vitest";
import { migrateConfigContent, generateDefaultConfigContent } from "@/lib/config/migration";

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

  it("quickAsk effort appears in generated default config", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("#   effort: medium");
  });

  it("disableAccessLog appears in generated default config", () => {
    const content = generateDefaultConfigContent();
    expect(content).toContain("#   disableAccessLog: false");
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

  it("type override hints include model and steps", () => {
    const input = [
      "operations:",
      "  maxConcurrent: 3",
      "",
    ].join("\n");
    const result = migrateConfigContent(input);
    expect(result).toContain("#   #   model: sonnet");
    expect(result).toContain("#   #   steps:");
    expect(result).toContain("#   #     <step-type>:");
    expect(result).toContain("#   #       model: haiku");
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

  it("replaces old 6-line hint block with new 15-line hint block", () => {
    const oldHint = [
      "#   # Per-operation-type overrides (any setting above except maxConcurrent):",
      "#   # <operation-type>:              # init / execute / review / create-pr / update-todo / etc.",
      "#   #   claudeTimeoutMinutes: 20",
      "#   #   functionTimeoutMinutes: 3",
      "#   #   defaultInteractionLevel: mid",
      "#   #   bestOfN: 0",
    ];
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
    expect(result).toContain("#   #   model: sonnet");
    expect(result).toContain("#   #   steps:");
    expect(result).toContain("#   #     <step-type>:");
    expect(result).toContain("#   #       model: haiku");
    // Block starts with "Built-in step defaults" marker
    const lines = result.split("\n");
    const markerIdx = lines.findIndex((l) => l.includes("Built-in step defaults"));
    expect(markerIdx).toBeGreaterThan(-1);
    // Count consecutive #   # lines after marker
    let end = markerIdx + 1;
    while (end < lines.length && lines[end].startsWith("#   #")) end++;
    const hintBlockLength = end - markerIdx;
    expect(hintBlockLength).toBe(17); // marker + hint lines
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
      "#   useCli: true",
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
