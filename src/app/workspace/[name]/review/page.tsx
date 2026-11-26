import { useEffect } from "react";
import { useRouter, useParams } from "@/lib/router/navigation";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useReviews } from "@/hooks/use-workspace";

export default function WorkspaceReviewPage() {
  const { name } = useParams<{ name: string }>();
  useDocumentTitle(`Review - ${name}`);
  const { reviews } = useReviews(name);
  const router = useRouter();

  useEffect(() => {
    if (reviews.length > 0) {
      router.replace(
        `/workspace/${encodeURIComponent(name)}/review/${reviews[0].timestamp}`
      );
    }
  }, [reviews, router, name]);

  return null;
}
