"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SELECT_CLASSNAME =
  "h-9 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function VendorTagFilter({ tags }: { tags: string[] }) {
  const t = useTranslations("Vendors");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTag = searchParams.get("tag") ?? "";

  if (tags.length === 0) {
    return null;
  }

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("tag", value);
    } else {
      params.delete("tag");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      value={activeTag}
      onChange={(event) => handleChange(event.target.value)}
      className={SELECT_CLASSNAME}
      aria-label={t("tagFilter.label")}
    >
      <option value="">{t("tagFilter.all")}</option>
      {tags.map((tag) => (
        <option key={tag} value={tag}>
          {tag}
        </option>
      ))}
    </select>
  );
}
