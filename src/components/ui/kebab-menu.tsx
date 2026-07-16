"use client";

import { Menu } from "@base-ui/react/menu";
import { MoreVertical } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function KebabMenu({
  items,
  label,
}: {
  items: {
    label: string;
    onClick: () => void;
    destructive?: boolean;
    disabled?: boolean;
  }[];
  label: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50 outline-none">
          <Menu.Popup className="min-w-[160px] rounded-lg border border-line bg-surface p-1 shadow-lg outline-none">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                disabled={item.disabled}
                onClick={item.onClick}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  item.destructive ? "text-destructive" : "text-ink"
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
