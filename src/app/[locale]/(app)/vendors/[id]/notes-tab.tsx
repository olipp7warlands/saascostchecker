"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateVendor } from "@/features/vendors/actions";

type Vendor = {
  id: string;
  name: string;
  website: string;
  category: string;
  owner_user_id: string | null;
  status: string;
  notes: string | null;
};

export function NotesTab({ vendor }: { vendor: Vendor }) {
  const t = useTranslations("Vendors.detail");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [notes, setNotes] = useState(vendor.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateVendor({
        vendorId: vendor.id,
        name: vendor.name,
        website: vendor.website,
        category: vendor.category,
        ownerUserId: vendor.owner_user_id,
        status: vendor.status,
        notes,
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={8}
        maxLength={2000}
        placeholder={t("notesPlaceholder")}
        className="rounded-input border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={handleSave} disabled={isPending} className="self-start">
        {t("save")}
      </Button>
    </div>
  );
}
