import type { Metadata } from "next";

export const metadata: Metadata = { title: "Running Operations" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
