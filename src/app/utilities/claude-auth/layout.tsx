import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claude Auth" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
