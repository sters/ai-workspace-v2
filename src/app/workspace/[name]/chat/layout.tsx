"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SUB_TABS = [
  { label: "Quick Ask", segment: "quick" },
  { label: "Interactive Chat", segment: "interactive" },
] as const;

export default function ChatLayout({
  params,
  children,
}: {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}) {
  const { name } = use(params);
  const pathname = usePathname();
  const basePath = `/workspace/${name}/chat`;
  const activeSegment = pathname.replace(basePath, "").replace(/^\//, "");

  return (
    <div>
      <div className="mb-4 flex border-b">
        {SUB_TABS.map((tab) => {
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
      {children}
    </div>
  );
}
