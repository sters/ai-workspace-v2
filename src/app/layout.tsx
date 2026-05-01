import type { Metadata } from "next";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { ToastHost } from "@/components/shared/feedback/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-workspace",
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

          {/* Main */}
          <main className="flex-1 overflow-auto">
            <div className="mx-auto max-w-6xl p-6">{children}</div>
          </main>
        </div>
        <ToastHost />
      </body>
    </html>
  );
}
