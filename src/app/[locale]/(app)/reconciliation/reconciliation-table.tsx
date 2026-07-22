"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";
import { CATALOG_CATEGORIES } from "@/features/catalog/types";
import {
  bulkAcceptReconciliation,
  createVendorFromReconciliation,
  ignoreReconciliation,
  linkReconciliation,
} from "@/features/reconciliation/actions";
import { confidenceTier, type ReconciliationQueueRow } from "@/features/reconciliation/types";

const TIER_TONE: Record<string, PillTone> = {
  high: "green",
  medium: "amber",
  none: "neutral",
};

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Vendor = { id: string; name: string };

export function ReconciliationTable({
  rows,
  vendors,
  locale,
}: {
  rows: ReconciliationQueueRow[];
  vendors: Vendor[];
  locale: string;
}) {
  const t = useTranslations("Reconciliation");
  const tGeneric = useTranslations("Auth");
  const tCategory = useTranslations("Catalog.category");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [linkingFor, setLinkingFor] = useState<Record<string, string>>({});

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), [locale]);

  const highConfidenceIds = useMemo(
    () => rows.filter((row) => confidenceTier(row.confidence) === "high").map((row) => row.id),
    [rows],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllHighConfidence() {
    setSelected((prev) => (prev.size === highConfidenceIds.length ? new Set() : new Set(highConfidenceIds)));
  }

  function handleLinkSuggested(row: ReconciliationQueueRow) {
    if (!row.suggestedCatalogId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkReconciliation({
        queueId: row.id,
        vendorId: null,
        catalogId: row.suggestedCatalogId,
      });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      router.refresh();
    });
  }

  function handleLinkExisting(row: ReconciliationQueueRow) {
    const vendorId = linkingFor[row.id];
    if (!vendorId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkReconciliation({ queueId: row.id, vendorId, catalogId: null });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      router.refresh();
    });
  }

  function handleIgnore(row: ReconciliationQueueRow) {
    setError(null);
    startTransition(async () => {
      const result = await ignoreReconciliation({ queueId: row.id });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      router.refresh();
    });
  }

  function handleCreateVendor(row: ReconciliationQueueRow, formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createVendorFromReconciliation({
        queueId: row.id,
        vendorName: formData.get("vendorName"),
        website: formData.get("website"),
        category: formData.get("category"),
      });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      setCreatingFor(null);
      router.refresh();
    });
  }

  function handleBulkAccept() {
    if (selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkAcceptReconciliation({ queueIds: Array.from(selected) });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {highConfidenceIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.size === highConfidenceIds.length}
              onChange={toggleSelectAllHighConfidence}
            />
            {t("selectAllHighConfidence", { count: highConfidenceIds.length })}
          </label>
          <Button
            size="sm"
            disabled={selected.size === 0 || isPending}
            onClick={handleBulkAccept}
            className="ml-auto"
          >
            {t("bulkAcceptButton", { count: selected.size })}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* contain-layout: evita que el layout automático de esta tabla (min-w
          fija, columnas dimensionadas por contenido) ensanche el viewport
          móvil entero — ver vendors/page.tsx para el diagnóstico completo. */}
      <div className="overflow-x-auto contain-layout rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase" />
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                {t("table.date")}
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                {t("table.amount")}
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                {t("table.description")}
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                {t("table.suggestion")}
              </th>
              <th className="border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                {t("table.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tier = confidenceTier(row.confidence);
              const currencyFormatter = new Intl.NumberFormat(locale, {
                style: "currency",
                currency: row.currency,
              });
              return (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="border-b border-line px-3 py-3">
                    {tier === "high" && (
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                      />
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-3 text-sm text-ink-soft whitespace-nowrap">
                    {row.date ? dateFormatter.format(new Date(`${row.date}T00:00:00`)) : "—"}
                  </td>
                  <td className="num border-b border-line px-3 py-3 text-sm text-ink whitespace-nowrap">
                    {currencyFormatter.format(row.amount)}
                  </td>
                  <td className="border-b border-line px-3 py-3 text-sm text-ink">{row.rawDescription}</td>
                  <td className="border-b border-line px-3 py-3">
                    {row.suggestedName ? (
                      <Pill tone={TIER_TONE[tier]}>
                        {row.suggestedName} · {t(`confidence.${tier}`)}
                      </Pill>
                    ) : (
                      <Pill tone="neutral">{t("confidence.none")}</Pill>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-3">
                    {creatingFor === row.id ? (
                      <form
                        action={(formData) => handleCreateVendor(row, formData)}
                        className="flex flex-col gap-1.5"
                      >
                        <Input
                          name="vendorName"
                          required
                          maxLength={200}
                          placeholder={t("vendorNamePlaceholder")}
                          defaultValue={row.rawDescription.slice(0, 60)}
                        />
                        <Input name="website" required maxLength={255} placeholder="ejemplo.com" />
                        <select name="category" defaultValue="other" className={SELECT_CLASSNAME}>
                          {CATALOG_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {tCategory(category)}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1.5">
                          <Button type="submit" size="sm" disabled={isPending}>
                            {t("confirmCreateVendor")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setCreatingFor(null)}
                          >
                            {t("cancel")}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          {row.suggestedCatalogId && (
                            <Button size="sm" disabled={isPending} onClick={() => handleLinkSuggested(row)}>
                              {t("linkSuggested")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => setCreatingFor(row.id)}
                          >
                            {t("createVendor")}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => handleIgnore(row)}>
                            {t("ignore")}
                          </Button>
                        </div>
                        <div className="flex gap-1.5">
                          <select
                            className={SELECT_CLASSNAME}
                            value={linkingFor[row.id] ?? ""}
                            onChange={(event) =>
                              setLinkingFor((prev) => ({ ...prev, [row.id]: event.target.value }))
                            }
                          >
                            <option value="">{t("linkExistingPlaceholder")}</option>
                            {vendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.id}>
                                {vendor.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending || !linkingFor[row.id]}
                            onClick={() => handleLinkExisting(row)}
                          >
                            {t("linkExisting")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
