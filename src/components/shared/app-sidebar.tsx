"use client";

import { useCallback, useState } from "react";
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
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggle = useCallback(() => {
    setOpenSection(null);
    setSidebarCollapsed(!collapsed);
  }, [collapsed]);

  return (
    <aside
      className={cn(
        // Elevated above the workspace sidebar: the sticky child below is its
        // own stacking context, so the hover flyout's z-index cannot reach out
        // of it and the later sibling would otherwise paint over the flyout.
        "relative z-30 shrink-0 border-r bg-card",
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
                const open = !!section.children && openSection === section.href;
                return (
                  <div
                    key={section.href}
                    className="relative"
                    onMouseEnter={() => setOpenSection(section.href)}
                    onMouseLeave={() => setOpenSection(null)}
                    onFocus={() => setOpenSection(section.href)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setOpenSection(null);
                      }
                    }}
                  >
                    <Link
                      href={section.href}
                      aria-label={section.label}
                      title={section.label}
                      aria-current={active ? "page" : undefined}
                      aria-expanded={section.children ? open : undefined}
                      className={cn(
                        "block rounded-md p-2 hover:bg-accent",
                        active
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                    {open && (
                      // Padded rather than offset with a margin: the gap has to
                      // belong to the hoverable wrapper, or crossing it closes
                      // the flyout before the pointer arrives.
                      <div className="absolute left-full top-0 z-50 pl-1">
                        <div className="max-h-[calc(100vh-1rem)] w-52 overflow-y-auto rounded-md border bg-card py-1 shadow-md">
                          <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">
                            {section.label}
                          </div>
                          {section.children?.map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              aria-current={
                                pathname === item.href ? "page" : undefined
                              }
                              className={cn(
                                "block px-3 py-1.5 text-xs hover:bg-accent hover:text-foreground",
                                pathname === item.href
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
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
