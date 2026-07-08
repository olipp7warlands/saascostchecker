"use client";

import { useState } from "react";
import { colorForName } from "@/features/catalog/color";
import { cn } from "@/lib/utils";

export function AppLogo({
  domain,
  name,
  size = 26,
  className,
}: {
  domain: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = failed || !domain;

  if (showFallback) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[7px] font-semibold text-white",
          className,
        )}
        style={{
          width: size,
          height: size,
          background: colorForName(name),
          fontSize: Math.round(size * 0.46),
        }}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- favicon domain es dinámico por fila (una por vendor), no hay un set fijo para next/image remotePatterns
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={size}
      height={size}
      className={cn(
        "shrink-0 rounded-[7px] border border-line bg-white object-contain p-[3px]",
        className,
      )}
      onError={() => setFailed(true)}
    />
  );
}
