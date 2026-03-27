import Link from "next/link";
import { PushToggle } from "./push-toggle";

const UTILITY_ITEMS = [
  { label: "Workspace Prune", href: "/utilities/workspace-prune" },
  { label: "Operation Log Prune", href: "/utilities/operation-prune" },
  { label: "MCP Servers", href: "/utilities/mcp-servers" },
  { label: "Claude Version", href: "/utilities/claude-version" },
  { label: "Claude Usage", href: "/utilities/claude-usage" },
  { label: "AIW Settings", href: "/utilities/aiw-settings" },
  { label: "Claude Settings", href: "/utilities/claude-settings" },
  { label: "Claude Auth", href: "/utilities/claude-auth" },
  { label: "Running Operations", href: "/utilities/running" },
  { label: "Check Update", href: "/utilities/check-update" },
];

export function AppSidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="border-b p-4">
          <Link href="/" className="text-lg font-bold">
            ai-workspace
          </Link>
        </div>
        <nav className="flex-1 p-2">
          <Link
            href="/"
            className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
          >
            Dashboard
          </Link>
          <div>
            <Link
              href="/new"
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              New Workspace
            </Link>
            <div className="ml-3 border-l pl-2">
              <Link
                href="/suggestions"
                className="block rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Suggestions
              </Link>
            </div>
          </div>
          <div>
            <Link
              href="/utilities"
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              Utilities
            </Link>
            <div className="ml-3 border-l pl-2">
              {UTILITY_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <div className="border-t p-3">
          <PushToggle />
          <div className="mt-2 text-xs text-muted-foreground">
            {process.env.NEXT_PUBLIC_GIT_HASH ?? "dev"}
          </div>
        </div>
      </div>
    </aside>
  );
}
