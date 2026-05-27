import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claude Version" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
