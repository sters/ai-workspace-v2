import { Suspense } from "react";
import { WorkspaceLayoutContent } from "@/components/workspace/workspace-layout-content";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-1/3 rounded bg-muted" />
          <div className="h-64 rounded bg-muted" />
        </div>
      }
    >
      <WorkspaceLayoutContent>
        {children}
      </WorkspaceLayoutContent>
    </Suspense>
  );
}
