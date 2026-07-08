"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { revokeInvitation } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";

export function RevokeButton({
  invitationId,
  label,
}: {
  invitationId: string;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await revokeInvitation(invitationId);
      if (!("error" in result)) {
        router.refresh();
      }
    });
  }

  return (
    <Button variant="ghost" size="sm" disabled={isPending} onClick={handleClick}>
      {label}
    </Button>
  );
}
