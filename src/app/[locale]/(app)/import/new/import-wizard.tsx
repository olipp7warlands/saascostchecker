"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { commitCsvImport, previewCsvImport } from "@/features/spend-import/actions";
import { CSV_DATE_FORMATS, CSV_DECIMAL_FORMATS, type CsvDateFormat, type CsvDecimalFormat } from "@/features/spend-import/parsing";
import type { CsvPreview } from "@/features/spend-import/types";

const SELECT_CLASSNAME =
  "h-8 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Step = "upload" | "mapping" | "done";

type Summary = { imported: number; duplicates: number; errors: number };

export function ImportWizard({ locale }: { locale: string }) {
  const t = useTranslations("SpendImport.new");
  const tGeneric = useTranslations("Auth");
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [hasHeader, setHasHeader] = useState(true);
  const [dateColumn, setDateColumn] = useState(0);
  const [amountColumn, setAmountColumn] = useState(1);
  const [descriptionColumn, setDescriptionColumn] = useState(2);
  const [dateFormat, setDateFormat] = useState<CsvDateFormat>("DD/MM/YYYY");
  const [decimalFormat, setDecimalFormat] = useState<CsvDecimalFormat>("es");

  const columns = useMemo(() => {
    if (!preview) return [];
    return hasHeader
      ? (preview.rawRows[0] ?? [])
      : (preview.rawRows[0] ?? []).map((_, index) => `${t("columnFallback")} ${index + 1}`);
  }, [preview, hasHeader, t]);

  const previewDataRows = useMemo(() => {
    if (!preview) return [];
    return hasHeader ? preview.rawRows.slice(1) : preview.rawRows;
  }, [preview, hasHeader]);

  function handleUpload(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const file = formData.get("file");
      const result = await previewCsvImport({ file });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      setPreview(result);
      setStep("mapping");
    });
  }

  function handleCommit() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const result = await commitCsvImport({
        batchId: preview.batchId,
        hasHeader,
        dateColumn,
        amountColumn,
        descriptionColumn,
        dateFormat,
        decimalFormat,
      });
      if ("error" in result) {
        setError(result.error || tGeneric("errorGeneric"));
        return;
      }
      setSummary({
        imported: result.imported ?? 0,
        duplicates: result.duplicates ?? 0,
        errors: result.errors ?? 0,
      });
      setStep("done");
    });
  }

  if (step === "upload") {
    return (
      <form action={handleUpload} className="flex flex-col gap-4 rounded-lg border border-line p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="file">{t("uploadLabel")}</Label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary-foreground"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isPending}>
          {t("uploadButton")}
        </Button>
      </form>
    );
  }

  if (step === "mapping" && preview) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-lg border border-line p-4">
          <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
            {t("detectedLabel")}
          </p>
          <p className="mt-1 text-sm text-ink">
            {t("detectedSummary", { delimiter: preview.delimiter, encoding: preview.encoding })}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(event) => setHasHeader(event.target.checked)}
          />
          {t("hasHeaderLabel")}
        </label>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={index}
                    className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-ink-soft uppercase"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewDataRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-line px-3 py-2 text-ink">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dateColumn">{t("dateColumnLabel")}</Label>
            <select
              id="dateColumn"
              className={SELECT_CLASSNAME}
              value={dateColumn}
              onChange={(event) => setDateColumn(Number(event.target.value))}
            >
              {columns.map((column, index) => (
                <option key={index} value={index}>
                  {column}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dateFormat">{t("dateFormatLabel")}</Label>
            <select
              id="dateFormat"
              className={SELECT_CLASSNAME}
              value={dateFormat}
              onChange={(event) => setDateFormat(event.target.value as CsvDateFormat)}
            >
              {CSV_DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amountColumn">{t("amountColumnLabel")}</Label>
            <select
              id="amountColumn"
              className={SELECT_CLASSNAME}
              value={amountColumn}
              onChange={(event) => setAmountColumn(Number(event.target.value))}
            >
              {columns.map((column, index) => (
                <option key={index} value={index}>
                  {column}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="decimalFormat">{t("decimalFormatLabel")}</Label>
            <select
              id="decimalFormat"
              className={SELECT_CLASSNAME}
              value={decimalFormat}
              onChange={(event) => setDecimalFormat(event.target.value as CsvDecimalFormat)}
            >
              {CSV_DECIMAL_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`decimalFormat.${format}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="descriptionColumn">{t("descriptionColumnLabel")}</Label>
            <select
              id="descriptionColumn"
              className={SELECT_CLASSNAME}
              value={descriptionColumn}
              onChange={(event) => setDescriptionColumn(Number(event.target.value))}
            >
              {columns.map((column, index) => (
                <option key={index} value={index}>
                  {column}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleCommit} disabled={isPending}>
          {t("continueButton")}
        </Button>
      </div>
    );
  }

  if (step === "done" && summary) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-line p-4">
        <p className="text-sm text-ink">
          {t("summaryImported", { count: summary.imported })}
          <br />
          {t("summaryDuplicates", { count: summary.duplicates })}
          <br />
          {t("summaryErrors", { count: summary.errors })}
        </p>
        <a
          href={`/${locale}/reconciliation`}
          className="inline-flex h-9 w-fit items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {t("viewQueueButton")}
        </a>
      </div>
    );
  }

  return null;
}
