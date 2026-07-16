import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-xs">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="flex items-center gap-1.5">
                {isLast || !item.href ? (
                  <span
                    className="font-medium text-ink"
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="text-ink-soft underline-offset-2 hover:text-ink hover:underline"
                  >
                    {item.label}
                  </a>
                )}
              </li>
              {!isLast && (
                <ChevronRight className="size-3.5 text-ink-soft" aria-hidden="true" />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
