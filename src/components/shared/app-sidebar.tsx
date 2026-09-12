"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  FolderPlus,
  LayoutDashboard,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  setSidebarCollapsed,
  useSidebarCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";
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
  { label: "Notification Logs", href: "/utilities/notification-logs" },
  { label: "Snippets", href: "/utilities/snippets" },
  { label: "Check Update", href: "/utilities/check-update" },
];

interface NavSection {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that belong to this section. */
  match?: string[];
  /** Matched by equality only — a landing page with sub-routes elsewhere. */
  exact?: boolean;
  children?: { label: string; href: string }[];
}

const NAV_SECTIONS: NavSection[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  {
    label: "New Workspace",
    href: "/new",
    icon: FolderPlus,
    match: ["/suggestions"],
    children: [
      { label: "Quick (no AI)", href: "/new/quick" },
      { label: "From PR", href: "/new/from-pr" },
      { label: "Suggestions", href: "/suggestions" },
    ],
  },
  {
    label: "Utilities",
    href: "/utilities",
    icon: Wrench,
    children: UTILITY_ITEMS,
  },
];

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isSectionActive(pathname: string, section: NavSection): boolean {
  if (section.exact) return pathname === section.href;
  return (
    isUnder(pathname, section.href) ||
    (section.match?.some((p) => isUnder(pathname, p)) ?? false)
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();

  const toggle = useCallback(
    () => setSidebarCollapsed(!collapsed),
    [collapsed],
  );

  return (
    <aside
      className={cn(
        "shrink-0 border-r bg-card",
        collapsed ? "w-12" : "w-56",
      )}
    >
      <div className="sticky top-0 flex h-screen flex-col">
        {collapsed ? (
          <>
            <div className="flex justify-center border-b p-2">
              <button
                onClick={toggle}
                aria-label="Expand sidebar"
                title="Expand sidebar"
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col items-center gap-1 p-2">
              {NAV_SECTIONS.map((section) => {
                const Icon = section.icon;
                const active = isSectionActive(pathname, section);
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    aria-label={section.label}
                    title={section.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md p-2 hover:bg-accent",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                );
              })}
            </nav>
            <div className="flex flex-col items-center border-t p-2">
              <PushToggle compact />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b p-4">
              <Link href="/" className="text-lg font-bold">
                ai-workspace
              </Link>
              <button
                onClick={toggle}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {NAV_SECTIONS.map((section) => (
                <div key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={
                      isSectionActive(pathname, section) ? "page" : undefined
                    }
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm hover:bg-accent",
                      isSectionActive(pathname, section) && "bg-accent",
                    )}
                  >
                    {section.label}
                  </Link>
                  {section.children && (
                    <div className="ml-3 border-l pl-2">
                      {section.children.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={
                            pathname === item.href ? "page" : undefined
                          }
                          className={cn(
                            "block rounded-md px-3 py-1.5 text-xs hover:bg-accent hover:text-foreground",
                            pathname === item.href
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
            <div className="border-t p-3">
              <PushToggle />
              <div className="mt-2 text-xs text-muted-foreground">
                {process.env.NEXT_PUBLIC_GIT_HASH ?? "dev"}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
