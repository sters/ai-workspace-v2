import Link from "next/link";
import { cardVariants } from "@/components/shared/containers/card";
import { PageHeader } from "@/components/shared/feedback/page-header";

const tools = [
  {
    href: "/utilities/workspace-prune",
    name: "Workspace Prune",
    description:
      "Delete workspaces not modified within the specified number of days.",
  },
  {
    href: "/utilities/operation-prune",
    name: "Operation Log Prune",
    description:
      "Delete operation logs older than the specified number of days.",
  },
  {
    href: "/utilities/mcp-servers",
    name: "MCP Servers",
    description:
      "View MCP servers configured for Claude Code across user, project, and local scopes.",
  },
  {
    href: "/utilities/claude-version",
    name: "Claude Version",
    description:
      "Display the currently installed Claude Code CLI version.",
  },
  {
    href: "/utilities/claude-usage",
    name: "Claude Usage",
    description:
      "Display current billing period usage from Claude Code CLI.",
  },
  {
    href: "/utilities/aiw-settings",
    name: "AIW Settings",
    description:
      "Edit .ai-workspace/config.yml. Changes take effect immediately.",
  },
  {
    href: "/utilities/claude-settings",
    name: "Claude Settings",
    description:
      "View and edit .claude/settings*.json files across project, local, and user scopes.",
  },
  {
    href: "/utilities/claude-auth",
    name: "Claude Auth",
    description: "Manage Claude Code authentication status and login.",
  },
  {
    href: "/utilities/running",
    name: "Running Operations",
    description:
      "View and manage all currently running operations.",
  },
];

export default function UtilitiesPage() {
  return (
    <div>
      <PageHeader title="Utilities" />
      <div className="grid gap-3">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className={cardVariants("default", "block hover:bg-accent")}
          >
            <h2 className="font-semibold">{tool.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tool.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
