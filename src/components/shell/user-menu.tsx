"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { signOut } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

export function UserMenu({
  locale,
  fullName,
  roleLabel,
  orgName,
  dark = true,
}: {
  locale: string;
  fullName: string | null;
  roleLabel: string;
  orgName: string;
  dark?: boolean;
}) {
  const t = useTranslations("Shell.userMenu");
  const [isPending, startTransition] = useTransition();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("open")}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-offset-1",
          dark
            ? "focus-visible:ring-white/50 focus-visible:ring-offset-ink hover:bg-white/5"
            : "focus-visible:ring-ring/50 focus-visible:ring-offset-surface hover:bg-muted",
        )}
      >
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-[13px] font-semibold",
              dark ? "text-white" : "text-ink",
            )}
          >
            {fullName || orgName}
          </span>
          <span
            className={cn("block truncate text-xs", dark ? "text-[#9AA7AE]" : "text-ink-soft")}
          >
            {roleLabel} · {orgName}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0", dark ? "text-[#9AA7AE]" : "text-ink-soft")}
          aria-hidden="true"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50 outline-none">
          <Menu.Popup className="min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-lg outline-none">
            <Menu.Item
              disabled={isPending}
              onClick={() => startTransition(() => signOut(locale))}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t("signOut")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
