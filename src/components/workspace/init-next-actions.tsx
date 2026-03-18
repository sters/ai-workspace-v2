"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import { buttonVariants } from "@/components/shared/buttons/button";
import { Callout } from "@/components/shared/containers/callout";
import { buildBatchItems } from "@/lib/batch-modes";

export function InitNextActions({ workspace }: { workspace: string }) {
  const router = useRouter();
  const wsEncoded = encodeURIComponent(workspace);

  return (
    <Callout variant="info">
      <p className="mb-2 text-sm font-medium text-foreground">Next steps</p>
      <div className="flex flex-wrap gap-2">
        <SplitButton
          label="Execute"
          onClick={() =>
            router.push(`/workspace/${wsEncoded}?action=execute`)
          }
          items={buildBatchItems("execute", {}, ({ startWith, mode }) =>
            router.push(
              `/workspace/${wsEncoded}?action=batch&startWith=${startWith}&mode=${mode}`,
            )
          )}
        />
        <Link
          href={`/workspace/${wsEncoded}`}
          className={buttonVariants("outline", "bg-background px-3 py-1.5 text-sm text-foreground")}
        >
          View Workspace
        </Link>
      </div>
    </Callout>
  );
}
