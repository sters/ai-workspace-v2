"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Project", segment: "project" },
  { label: "Local", segment: "local" },
  { label: "User", segment: "user" },
] as const;

export default function ClaudeSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const basePath = "/utilities/claude-settings";
  const activeSegment =
    pathname.replace(basePath, "").replace(/^\//, "").split("/")[0] || "project";

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Claude Settings</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        View and edit <code className="text-xs">.claude/settings*.json</code>{" "}
        files across project, local, and user scopes.
      </p>

      <div className="mb-4 flex border-b">
        {TABS.map((tab) => {
          const href = `${basePath}/${tab.segment}`;
          const isActive = activeSegment === tab.segment;
          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
