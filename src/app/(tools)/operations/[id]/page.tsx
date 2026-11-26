import { useEffect } from "react";
import useSWR from "swr";
import { useParams, useRouter } from "@/lib/router/navigation";
import { fetcher } from "@/lib/api";
import type { OperationPage as OperationPageTarget } from "@/lib/operation-page";
import { OperationDetail } from "@/components/operation/operation-detail";
import { StatusText } from "@/components/shared/feedback/status-text";

export default function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<OperationPageTarget>(
    `/api/operation-page/${encodeURIComponent(id)}`,
    fetcher,
  );

  useEffect(() => {
    if (data?.kind === "workspace") router.replace(data.href);
  }, [data, router]);

  if (isLoading) return <StatusText>Loading...</StatusText>;
  if (error || !data) return <StatusText variant="error">Operation not found.</StatusText>;
  if (data.kind === "workspace") return null;
  return <OperationDetail operation={data.operation} onRefresh={() => void mutate()} />;
}
