import type { Metadata } from "next";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { WorkspaceSidebar } from "@/components/shared/workspace-sidebar";
import { ToastHost } from "@/components/shared/feedback/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ai-workspace",
    template: "%s | ai-workspace",
  },
  description: "Multi-repository workspace manager dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="flex min-h-screen">
          <AppSidebar />
          <WorkspaceSidebar />

          {/* Main. The reading-width constraint belongs to each section's own
              layout, since the workspace detail pages want the full width. */}
          <main className="min-w-0 flex-1 overflow-auto">
            <div className="p-6">{children}</div>
          </main>
        </div>
        <ToastHost />
      </body>
    </html>
  );
}
