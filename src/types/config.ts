export interface AppConfig {
  workspaceRoot: string | null;

  server: {
    port: number;
    chatPort: number;
  };

  claude: {
    path: string | null;
    useCli: boolean;
  };

  operations: {
    maxConcurrent: number;
    claudeTimeoutMinutes: number;
    functionTimeoutMinutes: number;
    defaultInteractionLevel: "low" | "mid" | "high";
    /** Best-of-N parallel execution count. 0 = disabled, 2-5 = parallel count. */
    bestOfN: number;
  };

  /** Editor launch command. Use `{path}` as placeholder for the target path. */
  editor: string;

  /** Terminal launch command. Use `{path}` as placeholder for the target path. */
  terminal: string;
}
