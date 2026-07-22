"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SheetNavItem = {
  key: string;
  href: string | null;
  icon: ReactNode;
  label: string;
  comingSoonLabel: string;
};

export function MoreNavSheet({
  locale,
  moreLabel,
  moreTitle,
  moreCloseLabel,
  dataSectionLabel,
  settingsSectionLabel,
  dataItems,
  settingsItems,
}: {
  locale: string;
  moreLabel: string;
  moreTitle: string;
  moreCloseLabel: string;
  dataSectionLabel: string;
  settingsSectionLabel: string;
  dataItems: SheetNavItem[];
  settingsItems: SheetNavItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-center text-[10.5px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          open ? "bg-lime-soft text-lime-ink" : "text-ink-soft hover:text-ink",
        )}
      >
        <MoreHorizontal className="size-[17px]" aria-hidden="true" />
        <span>{moreLabel}</span>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40 outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl outline-none data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <DialogPrimitive.Title className="font-disp text-base font-semibold text-ink">
              {moreTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={moreCloseLabel}
              className="rounded-md p-1 text-ink-soft outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="px-2 py-2">
            <NavGroup title={dataSectionLabel} items={dataItems} locale={locale} onNavigate={() => setOpen(false)} />
            <NavGroup
              title={settingsSectionLabel}
              items={settingsItems}
              locale={locale}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NavGroup({
  title,
  items,
  locale,
  onNavigate,
}: {
  title: string;
  items: SheetNavItem[];
  locale: string;
  onNavigate: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mb-2">
      <p className="px-3 pt-2 pb-1.5 text-[10.5px] font-semibold tracking-[.1em] text-ink-soft uppercase">
        {title}
      </p>
      {items.map((item) => {
        const disabled = !item.href;
        return disabled ? (
          <span
            key={item.key}
            aria-disabled="true"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft/60"
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal whitespace-nowrap text-ink-soft/60">
              {item.comingSoonLabel}
            </span>
          </span>
        ) : (
          <a
            key={item.key}
            href={`/${locale}${item.href}`}
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {item.icon}
            {item.label}
          </a>
        );
      })}
    </div>
  );
}
