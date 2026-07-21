"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SELECT_CLASSNAME =
  "h-9 rounded-input border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function FiscalYearSelect({ currentYear, years }: { currentYear: number; years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={currentYear}
      onChange={(event) => handleChange(event.target.value)}
      className={SELECT_CLASSNAME}
    >
      {years.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  );
}
