"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "List", segment: "", href: "/suggestions" },
  { label: "Discover", segment: "discover", href: "/suggestions/discover" },
  { label: "Aggregate", segment: "aggregate", href: "/suggestions/aggregate" },
  { label: "Prune", segment: "prune", href: "/suggestions/prune" },
] as const;

export default function SuggestionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeSegment = pathname.replace("/suggestions", "").replace(/^\//, "").split("/")[0] || "";

  return (
    <div>
      <PageHeader
        title="Suggestions"
        description="Out-of-scope items discovered during operations. Click a suggestion to create a new workspace."
      />

      <div className="mb-4 flex border-b">
        {TABS.map((tab) => {
          const isActive = tab.segment === activeSegment;
          const cls = cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            isActive
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          );
          return isActive ? (
            <span key={tab.segment} className={cls}>
              {tab.label}
            </span>
          ) : (
            <Link key={tab.segment} href={tab.href} className={cls}>
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
