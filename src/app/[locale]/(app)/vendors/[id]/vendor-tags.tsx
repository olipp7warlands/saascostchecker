"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { addVendorTag, removeVendorTag } from "@/features/vendors/actions";

// Siempre editable (no depende del toggle `editMode` general de la ficha) —
// los tags son de edición ligera y frecuente, mismo criterio que marcar un
// asiento inactivo en 1.4. Optimista: la UI refleja el cambio antes de que
// vuelva la RPC, y revierte si falla.
export function VendorTags({
  vendorId,
  tags: initialTags,
  orgTags,
}: {
  vendorId: string;
  tags: string[];
  orgTags: string[];
}) {
  const t = useTranslations("Vendors.tags");
  const [tags, setTags] = useState(initialTags);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const listId = `vendor-tags-${vendorId}`;
  const suggestions = orgTags.filter((tag) => !tags.includes(tag));

  function addTag(rawTag: string) {
    const tag = rawTag.trim().toLowerCase();
    setInput("");
    if (!tag || tags.includes(tag)) {
      return;
    }

    setError(null);
    setTags((prev) => [...prev, tag].sort());
    startTransition(async () => {
      const result = await addVendorTag({ vendorId, tag });
      if (result && "error" in result) {
        setError(result.error);
        setTags((prev) => prev.filter((existing) => existing !== tag));
      }
    });
  }

  function removeTag(tag: string) {
    setError(null);
    setTags((prev) => prev.filter((existing) => existing !== tag));
    startTransition(async () => {
      const result = await removeVendorTag({ vendorId, tag });
      if (result && "error" in result) {
        setError(result.error);
        setTags((prev) => [...prev, tag].sort());
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
        {t("label")}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-btn border border-line bg-surface px-2.5 py-1 text-xs text-ink"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={t("remove", { tag })}
              className="text-ink-soft hover:text-destructive"
            >
              ×
            </button>
          </span>
        ))}
        <input
          aria-label={t("label")}
          list={listId}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag(input);
            }
          }}
          onBlur={() => {
            if (input.trim()) {
              addTag(input);
            }
          }}
          placeholder={t("addPlaceholder")}
          className="h-7 w-32 rounded-input border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
