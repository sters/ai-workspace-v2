/** Default .claude/settings.local.json for new workspaces. */
export const INITIAL_SETTINGS_LOCAL = {
  permissions: {
    allow: [
      "WebFetch",
      "WebSearch",
      "Bash(git:*)",
      "Bash(gh:*)",
      "Bash(make:*)",
      "Bash(bun:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(go:*)",
      "Bash(cargo:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(wc:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "Bash(grep:*)",
      "Bash(rg:*)",
      "Bash(docker:*)",
      "Bash(curl:*)",
    ],
    deny: [],
  },
};
