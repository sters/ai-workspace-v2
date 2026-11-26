import { useCallback, useState } from "react";
import Link from "@/lib/router/link";
import { usePathname } from "@/lib/router/navigation";
import {
  Activity,
  Bell,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  Eraser,
  FolderPlus,
  LayoutDashboard,
  Lightbulb,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  setSidebarCollapsed,
  useSidebarCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/api";
import type { ClientConfig } from "@/lib/api/client-config";
import { PushToggle } from "./push-toggle";

interface NavSection {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that belong to this section. */
  match?: string[];
  /** `href` itself is matched by equality only — a landing page with sub-routes elsewhere. */
  exact?: boolean;
  children?: { label: string; href: string }[];
}

const NAV_SECTIONS: NavSection[] = [
  { label: "Workspace", href: "/", icon: LayoutDashboard, exact: true, match: ["/workspace"] },
  {
    label: "New Workspace",
    href: "/new",
    icon: FolderPlus,
    match: ["/suggestions"],
    children: [
      { label: "Suggestions", href: "/suggestions" },
    ],
  },
  { label: "Operations", href: "/operations", icon: Activity },
  { label: "Scheduled Jobs", href: "/scheduled-jobs", icon: CalendarClock },
  { label: "Repo Lessons", href: "/repo-lessons", icon: Lightbulb },
  { label: "Run Costs", href: "/run-costs", icon: CircleDollarSign },
  { label: "Notification Logs", href: "/notification-logs", icon: Bell },
  {
    label: "Settings",
    href: "/settings/aiw",
    icon: Settings,
    match: ["/settings"],
    children: [
      { label: "AIW Settings", href: "/settings/aiw" },
      { label: "Snippet: Init", href: "/settings/snippet/init" },
      { label: "Snippet: Chat", href: "/settings/snippet/chat" },
      { label: "Claude Auth", href: "/settings/claude/auth" },
      { label: "Claude Settings", href: "/settings/claude/settings" },
      { label: "Claude MCP Servers", href: "/settings/claude/mcp-servers" },
      { label: "Claude Version", href: "/settings/claude/version" },
      { label: "Claude Usage", href: "/settings/claude/usage" },
    ],
  },
  {
    label: "Cleanups",
    href: "/cleanup/workspace",
    icon: Eraser,
    match: ["/cleanup"],
    children: [
      { label: "Workspace", href: "/cleanup/workspace" },
      { label: "Operation Log", href: "/cleanup/operation-log" },
      { label: "Repository", href: "/cleanup/repository" },
    ],
  },
  { label: "Check Update", href: "/check-update", icon: RefreshCw },
];

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isSectionActive(pathname: string, section: NavSection): boolean {
  const own = section.exact ? pathname === section.href : isUnder(pathname, section.href);
  return own || (section.match?.some((p) => isUnder(pathname, p)) ?? false);
}

export function AppSidebar() {
  const { data: clientConfig } = useSWR<ClientConfig>("/api/client-config", fetcher);
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
                                isUnder(pathname, item.href) ? "page" : undefined
                              }
                              className={cn(
                                "block px-3 py-1.5 text-xs hover:bg-accent hover:text-foreground",
                                isUnder(pathname, item.href)
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
                            isUnder(pathname, item.href) ? "page" : undefined
                          }
                          className={cn(
                            "block rounded-md px-3 py-1.5 text-xs hover:bg-accent hover:text-foreground",
                            isUnder(pathname, item.href)
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
                {clientConfig?.gitHash}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
