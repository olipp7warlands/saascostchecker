"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATALOG_CATEGORIES } from "@/features/catalog/types";
import { deleteVendor, updateVendor } from "@/features/vendors/actions";

type Vendor = {
  id: string;
  name: string;
  website: string;
  category: string;
  owner_user_id: string | null;
  status: string;
  notes: string | null;
};
type Member = { id: string; full_name: string | null; email: string };

const SELECT_CLASSNAME =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function VendorEditForm({
  locale,
  vendor,
  members,
}: {
  locale: string;
  vendor: Vendor;
  members: Member[];
}) {
  const t = useTranslations("Vendors.detail");
  const tNew = useTranslations("Vendors.new");
  const tCategory = useTranslations("Catalog.category");
  const tGeneric = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateVendor({
        vendorId: vendor.id,
        name: formData.get("name"),
        website: formData.get("website"),
        category: formData.get("category"),
        ownerUserId: formData.get("ownerUserId"),
        status: formData.get("status"),
        notes: formData.get("notes"),
      });
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!window.confirm(t("confirmDeleteVendor"))) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteVendor(locale, vendor.id);
      if (result && "error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
      }
    });
  }

  return (
    <form action={handleSave} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{tNew("nameLabel")}</Label>
        <Input id="name" name="name" required minLength={1} maxLength={200} defaultValue={vendor.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="website">{tNew("websiteLabel")}</Label>
        <Input id="website" name="website" required maxLength={255} defaultValue={vendor.website} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category">{tNew("categoryLabel")}</Label>
        <select
          id="category"
          name="category"
          defaultValue={vendor.category}
          className={SELECT_CLASSNAME}
        >
          {CATALOG_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {tCategory(category)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ownerUserId">{tNew("ownerLabel")}</Label>
        <select
          id="ownerUserId"
          name="ownerUserId"
          defaultValue={vendor.owner_user_id ?? ""}
          className={SELECT_CLASSNAME}
        >
          <option value="">{tNew("noOwnerOption")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">{t("statusLabel")}</Label>
        <select id="status" name="status" defaultValue={vendor.status} className={SELECT_CLASSNAME}>
          <option value="active">{t("status.active")}</option>
          <option value="inactive">{t("status.inactive")}</option>
          <option value="trial">{t("status.trial")}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">{tNew("notesLabel")}</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={vendor.notes ?? ""}
          className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {t("save")}
        </Button>
        <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete}>
          {t("deleteVendor")}
        </Button>
      </div>
    </form>
  );
}
