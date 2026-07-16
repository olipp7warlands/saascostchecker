import { Wordmark } from "@/components/brand/wordmark";
import { LocaleSwitcher } from "./locale-switcher";
import { UserMenu } from "./user-menu";

export function MobileHeader({
  locale,
  fullName,
  roleLabel,
  orgName,
}: {
  locale: string;
  fullName: string | null;
  roleLabel: string;
  orgName: string;
}) {
  return (
    <header className="flex items-center justify-between gap-3 bg-ink px-4 py-3 md:hidden">
      <Wordmark className="text-base text-white" />
      <div className="flex min-w-0 items-center gap-3">
        <LocaleSwitcher locale={locale} />
        <div className="w-[130px] min-w-0">
          <UserMenu locale={locale} fullName={fullName} roleLabel={roleLabel} orgName={orgName} />
        </div>
      </div>
    </header>
  );
}
