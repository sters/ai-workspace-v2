import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import type { ConfigArray } from "typescript-eslint";

const SPAWN_MESSAGE = "Blocks the event loop; use runProcess from @/lib/process/run.";
const FS_MESSAGE = "Blocks the event loop; use node:fs/promises (or pathExists / globScan from @/lib/fs).";

const SYNC_SPAWN_PROPERTIES = [
  { object: "Bun", property: "spawnSync", message: SPAWN_MESSAGE },
  { object: "Bun", property: "sleepSync", message: "Blocks the event loop; use await Bun.sleep()." },
];
const SYNC_SPAWN_IMPORTS = ["node:child_process", "child_process"].map((name) => ({
  name,
  importNames: ["spawnSync", "execSync", "execFileSync"],
  message: SPAWN_MESSAGE,
}));

const SYNC_FS_FUNCTIONS = [
  "accessSync", "appendFileSync", "chmodSync", "closeSync", "copyFileSync", "cpSync", "existsSync",
  "fstatSync", "lstatSync", "mkdirSync", "mkdtempSync", "openSync", "opendirSync", "readFileSync",
  "readSync", "readdirSync", "readlinkSync", "realpathSync", "renameSync", "rmSync", "rmdirSync",
  "statSync", "symlinkSync", "truncateSync", "unlinkSync", "utimesSync", "writeFileSync", "writeSync",
];
const SYNC_FS_PROPERTIES = [
  ...SYNC_FS_FUNCTIONS.map((property) => ({ object: "fs", property, message: FS_MESSAGE })),
  { property: "scanSync", message: "Blocks the event loop; use globScan from @/lib/fs." },
];
const SYNC_FS_IMPORTS = ["node:fs", "fs"].map((name) => ({
  name,
  importNames: SYNC_FS_FUNCTIONS,
  message: FS_MESSAGE,
}));

export default tseslint.config(
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "bin/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...(nextPlugin.configs.recommended.rules as ConfigArray[number]["rules"]),
      ...(nextPlugin.configs["core-web-vitals"].rules as ConfigArray[number]["rules"]),
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The server is one JavaScript thread per process: a synchronous spawn,
    // sleep or filesystem call in a request path stalls every other request
    // until it returns. Use `@/lib/process/run`, `node:fs/promises` and
    // `@/lib/fs` instead. Tests may block freely.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/__tests__/**", "src/test-setup.ts"],
    rules: {
      "no-restricted-properties": ["error", ...SYNC_SPAWN_PROPERTIES, ...SYNC_FS_PROPERTIES],
      "no-restricted-imports": ["error", { paths: [...SYNC_SPAWN_IMPORTS, ...SYNC_FS_IMPORTS] }],
    },
  },
  {
    // One-time process initialization, read once and cached for the life of
    // the process. Their callers (`getConfig()`, `getDb()`, `getCliPath()`, …)
    // are synchronous by design and called from hundreds of sites, so the
    // filesystem stays synchronous here. Spawning still does not.
    files: [
      "src/lib/config/resolver.ts",
      "src/lib/config/migration.ts",
      "src/lib/db/connection.ts",
      "src/lib/db/migrate-jsonl.ts",
      "src/lib/web-push/vapid.ts",
      "src/lib/slack-server/memory-db.ts",
      "src/lib/claude/cli.ts",
      "src/lib/dev/prewarm.ts",
    ],
    rules: {
      "no-restricted-properties": ["error", ...SYNC_SPAWN_PROPERTIES],
      "no-restricted-imports": ["error", { paths: SYNC_SPAWN_IMPORTS }],
    },
  }
) satisfies ConfigArray;
