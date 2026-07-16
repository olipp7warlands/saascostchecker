"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { searchSaasCatalog } from "@/features/catalog/search";
import type { SaasCatalogEntry } from "@/features/catalog/types";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { AppLogo } from "./app-logo";

export type CatalogSearchFn = (query: string, limit: number) => Promise<SaasCatalogEntry[]>;

let browserClient: ReturnType<typeof createClient> | null = null;

const defaultSearch: CatalogSearchFn = (query, limit) => {
  browserClient ??= createClient();
  return searchSaasCatalog(browserClient, query, limit);
};

export function SaasCombobox({
  onSelect,
  onCreateCustom,
  search = defaultSearch,
  debounceMs = 120,
  limit = 8,
  placeholder,
  ariaLabel,
  className,
}: {
  onSelect: (entry: SaasCatalogEntry) => void;
  onCreateCustom?: (query: string) => void;
  search?: CatalogSearchFn;
  debounceMs?: number;
  limit?: number;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const t = useTranslations("Catalog.combobox");
  const tCategory = useTranslations("Catalog.category");
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SaasCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  const requestIdRef = useRef(0);
  const trimmedQuery = query.trim();
  const showListbox = trimmedQuery.length > 0 && !dismissed;
  const showCreateCustom =
    Boolean(onCreateCustom) && trimmedQuery.length > 0 && !loading && !error && results.length === 0;
  const optionCount = results.length + (showCreateCustom ? 1 : 0);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setLoading(false);
      setError(false);
      setActiveIndex(-1);
      return;
    }

    setLoading(true);
    setError(false);
    const requestId = ++requestIdRef.current;

    const timer = setTimeout(() => {
      search(trimmedQuery, limit)
        .then((entries) => {
          if (requestIdRef.current !== requestId) return;
          setResults(entries);
          setLoading(false);
          setActiveIndex(entries.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setResults([]);
          setLoading(false);
          setError(true);
          setActiveIndex(-1);
        });
    }, debounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search` es una prop que puede recrearse cada render; solo debouncear por texto/límite de verdad.
  }, [trimmedQuery, limit, debounceMs]);

  function selectAt(index: number) {
    if (index >= 0 && index < results.length) {
      const entry = results[index];
      onSelect(entry);
    } else if (showCreateCustom && index === results.length) {
      onCreateCustom?.(trimmedQuery);
    } else {
      return;
    }
    setQuery("");
    setResults([]);
    setDismissed(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setDismissed(false);
        setActiveIndex((current) => Math.min(current + 1, optionCount - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setDismissed(false);
        setActiveIndex((current) => Math.max(current - 1, 0));
        break;
      case "Enter":
        if (showListbox && activeIndex >= 0) {
          event.preventDefault();
          selectAt(activeIndex);
        }
        break;
      case "Escape":
        if (showListbox) {
          event.preventDefault();
          setDismissed(true);
        }
        break;
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDismissed(true);
    }
  }

  return (
    <div className={cn("relative", className)} onBlur={handleBlur}>
      <input
        role="combobox"
        type="text"
        autoComplete="off"
        aria-expanded={showListbox}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showListbox && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-label={ariaLabel ?? t("ariaLabel")}
        placeholder={placeholder ?? t("placeholder")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setDismissed(false);
        }}
        onKeyDown={handleKeyDown}
        className="h-9 w-full rounded-input border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />

      {showListbox && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {loading && (
            <li className="px-3 py-2 text-sm text-ink-soft" aria-hidden="true">
              {t("loading")}
            </li>
          )}

          {!loading && error && (
            <li className="px-3 py-2 text-sm text-destructive" role="alert">
              {t("error")}
            </li>
          )}

          {!loading &&
            !error &&
            results.map((entry, index) => (
              <li
                key={entry.id}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectAt(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm",
                  index === activeIndex && "bg-muted",
                )}
              >
                <AppLogo domain={entry.website} name={entry.name} size={22} />
                <span className="flex-1 truncate text-ink">{entry.name}</span>
                <span className="shrink-0 text-xs text-ink-soft">{tCategory(entry.category)}</span>
              </li>
            ))}

          {!loading && !error && results.length === 0 && !showCreateCustom && (
            <li className="px-3 py-2 text-sm text-ink-soft">{t("noResults", { query: trimmedQuery })}</li>
          )}

          {!loading && !error && showCreateCustom && (
            <li
              id={`${listboxId}-option-${results.length}`}
              role="option"
              aria-selected={activeIndex === results.length}
              onMouseEnter={() => setActiveIndex(results.length)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectAt(results.length)}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft",
                activeIndex === results.length && "bg-muted",
              )}
            >
              {t("createCustom", { query: trimmedQuery })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
