"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { deleteVendor } from "@/features/vendors/actions";

export function VendorRowActions({
  vendorId,
  locale,
  labels,
}: {
  vendorId: string;
  locale: string;
  labels: {
    menuLabel: string;
    edit: string;
    delete: string;
    confirmTitle: string;
    confirmDescription: string;
    cancel: string;
    errorGeneric: string;
  };
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteVendor(locale, vendorId);
      if (result && "error" in result) {
        setError(result.error || labels.errorGeneric);
      }
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <KebabMenu
        label={labels.menuLabel}
        items={[
          {
            label: labels.edit,
            onClick: () => router.push(`/${locale}/vendors/${vendorId}`),
          },
          {
            label: labels.delete,
            onClick: () => setConfirmOpen(true),
            destructive: true,
          },
        ]}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={labels.confirmTitle}
        description={labels.confirmDescription}
        confirmLabel={labels.delete}
        cancelLabel={labels.cancel}
        onConfirm={handleDelete}
        isPending={isPending}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}
