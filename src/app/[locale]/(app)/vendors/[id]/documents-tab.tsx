"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { getContractDocumentUrl } from "@/features/vendors/actions";

type Contract = { id: string; name: string; document_url: string | null };

export function DocumentsTab({ contracts }: { contracts: Contract[] }) {
  const t = useTranslations("Vendors.detail");
  const [error, setError] = useState<string | null>(null);

  async function handleView(contractId: string) {
    setError(null);
    const result = await getContractDocumentUrl(contractId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  if (contracts.length === 0) {
    return <p className="text-sm text-ink-soft">{t("noContracts")}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {contracts.map((contract) => (
        <div
          key={contract.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3"
        >
          <span className="text-sm font-medium text-ink">{contract.name}</span>
          {contract.document_url ? (
            <button
              type="button"
              onClick={() => handleView(contract.id)}
              className="text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
            >
              {t("viewDocument")}
            </button>
          ) : (
            <span className="text-sm text-ink-soft">{t("noDocument")}</span>
          )}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
