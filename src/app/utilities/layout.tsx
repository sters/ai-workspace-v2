import type { Metadata } from "next";

export const metadata: Metadata = { title: "Utilities" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl">{children}</div>;
}
