"use client"

import * as React from "react"

import { Tabs } from "@/components/ui/tabs"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "@/lib/utils"

// Variante "segmented control" (contenedor con pill activo, no subrayado) de
// los mismos primitivos base-ui que usa Tabs — mismo estado/teclado/ARIA
// (role="tablist"/"tab"), solo cambia el tratamiento visual. Ver CLAUDE.md
// "Jerarquía de botones": el segmento activo reutiliza los tokens del CTA
// primario (bg-primary/text-primary-foreground), nunca lime-ink sobre fondo
// oscuro (ilegible).
const SegmentedControl = Tabs

function SegmentedControlList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="segmented-control-list"
      className={cn(
        "inline-flex items-center gap-1 rounded-btn border border-line bg-surface p-1",
        className
      )}
      {...props}
    />
  )
}

function SegmentedControlItem({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="segmented-control-item"
      className={cn(
        "cursor-pointer rounded-[calc(var(--radius-btn)-4px)] px-3 py-1 text-xs font-medium text-ink outline-none transition-colors",
        "hover:not-data-[active]:bg-line/60",
        "data-[active]:bg-primary data-[active]:text-primary-foreground",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlList, SegmentedControlItem }
