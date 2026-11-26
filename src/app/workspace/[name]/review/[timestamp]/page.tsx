import { useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ReviewDetail } from "@/components/workspace/review-detail";

export default function ReviewTimestampPage() {
  const { name, timestamp } = useParams<{ name: string; timestamp: string }>();
  useDocumentTitle(`Review ${timestamp} - ${name}`);

  return <ReviewDetail workspaceName={name} timestamp={timestamp} />;
}
