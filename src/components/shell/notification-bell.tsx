"use client";

import { Menu } from "@base-ui/react/menu";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type NotificationPayload = {
  vendor_name?: string;
  contract_name?: string;
  days_until?: number;
  notice_expired?: boolean;
};

type NotificationRow = {
  id: string;
  threshold_days: number | null;
  payload: NotificationPayload;
  read_at: string | null;
};

export function NotificationBell({ dark = false }: { dark?: boolean }) {
  const t = useTranslations("Shell.notifications");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, threshold_days, payload, read_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as NotificationRow[] | null) ?? []);
    setLoaded(true);
  }, []);

  // Carga inicial para que el badge de no leídas sea correcto sin tener que
  // abrir el menú primero; se recarga también al abrir por si hubo cambios.
  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = items.filter((item) => !item.read_at).length;

  function markRead(id: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)),
    );
    startTransition(async () => {
      const supabase = createClient();
      await supabase.rpc("mark_notification_read", { p_notification_id: id });
    });
  }

  function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    startTransition(async () => {
      const supabase = createClient();
      await supabase.rpc("mark_all_notifications_read");
    });
  }

  return (
    <Menu.Root onOpenChange={(open) => open && load()}>
      <Menu.Trigger
        aria-label={t("bellLabel")}
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-offset-1",
          dark
            ? "focus-visible:ring-white/50 focus-visible:ring-offset-ink hover:bg-white/5"
            : "focus-visible:ring-ring/50 focus-visible:ring-offset-surface hover:bg-muted",
        )}
      >
        <Bell className={cn("size-4.5", dark ? "text-white" : "text-ink")} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        <span className="sr-only">{t("unreadCount", { count: unreadCount })}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={8} className="z-50 outline-none">
          <Menu.Popup className="max-h-[70vh] w-[320px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg outline-none">
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
              <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                {t("bellLabel")}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={markAllRead}
                  className="text-xs font-medium text-ink underline underline-offset-2 hover:text-ink-soft disabled:opacity-50"
                >
                  {t("markAllRead")}
                </button>
              )}
            </div>

            {loaded && items.length === 0 && (
              <p className="px-2.5 py-4 text-sm text-ink-soft">{t("empty")}</p>
            )}

            {items.map((item) => {
              const unread = !item.read_at;
              const message = item.payload.notice_expired
                ? t("noticeExpired", { vendorName: item.payload.vendor_name ?? "" })
                : t("renewalAlert", {
                    vendorName: item.payload.vendor_name ?? "",
                    days: item.payload.days_until ?? item.threshold_days ?? 0,
                  });

              return (
                <Menu.Item
                  key={item.id}
                  closeOnClick={false}
                  onClick={() => unread && markRead(item.id)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted",
                    unread ? "text-ink" : "text-ink-soft",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {unread && (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-lime"
                      />
                    )}
                    {message}
                  </span>
                  {item.payload.contract_name && (
                    <span className="text-xs text-ink-soft">{item.payload.contract_name}</span>
                  )}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
