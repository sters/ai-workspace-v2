import { notFound, redirect } from "next/navigation";
import { resolveOperationPage } from "@/lib/operation-page";
import { OperationDetail } from "@/components/operation/operation-detail";

export const dynamic = "force-dynamic";

export default async function OperationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = await resolveOperationPage(decodeURIComponent(id));
  if (!page) notFound();
  if (page.kind === "workspace") redirect(page.href);
  return <OperationDetail operation={page.operation} />;
}
