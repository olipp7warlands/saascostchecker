import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/features/auth/session";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { DelegationForm } from "./delegation-form";
import { DelegationRow } from "./delegation-row";

type RawDelegationRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  revoked_at: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function DelegationsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Settings.delegations");
  const profile = await getCurrentUserProfile();
  if (!profile) {
    redirect(`/${locale}/login`);
  }

  const supabase = await createClient();
  const { data: me } = await supabase.from("users").select("id").eq("auth_id", profile.authId).single();
  const { data: members } = await supabase
    .from("users")
    .select("id, full_name, email")
    .order("full_name", { ascending: true });

  const [{ data: ownDelegations }, { data: coveringFor }] = await Promise.all([
    supabase
      .from("approval_delegations")
      .select("id, starts_on, ends_on, revoked_at, users!approval_delegations_delegate_user_id_fkey(full_name, email)")
      .eq("delegator_user_id", me!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("approval_delegations")
      .select("id, starts_on, ends_on, revoked_at, users!approval_delegations_delegator_user_id_fkey(full_name, email)")
      .eq("delegate_user_id", me!.id)
      .order("created_at", { ascending: false }),
  ]);

  let allDelegations:
    | (RawDelegationRow & {
        delegator: { full_name: string | null; email: string } | null;
        delegate: { full_name: string | null; email: string } | null;
      })[]
    | null = null;

  if (profile.role === "org_admin") {
    const { data } = await supabase
      .from("approval_delegations")
      .select(
        "id, starts_on, ends_on, revoked_at, delegator:users!approval_delegations_delegator_user_id_fkey(full_name, email), delegate:users!approval_delegations_delegate_user_id_fkey(full_name, email)",
      )
      .order("created_at", { ascending: false });
    allDelegations = (data ?? []).map((row) => ({
      ...row,
      delegator: Array.isArray(row.delegator) ? row.delegator[0] : row.delegator,
      delegate: Array.isArray(row.delegate) ? row.delegate[0] : row.delegate,
    }));
  }

  const today = todayIso();

  function statusOf(row: RawDelegationRow): "active" | "upcoming" | "expired" | "revoked" {
    if (row.revoked_at) return "revoked";
    if (row.ends_on < today) return "expired";
    if (row.starts_on > today) return "upcoming";
    return "active";
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("ownTitle")}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t("ownDescription")}</p>
        <div className="mt-3">
          <DelegationForm locale={locale} delegatorUserId={me!.id} members={members ?? []} />
        </div>
        {!ownDelegations || ownDelegations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">{t("empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {ownDelegations.map((row) => {
              const other = Array.isArray(row.users) ? row.users[0] : row.users;
              return (
                <DelegationRow
                  key={row.id}
                  locale={locale}
                  id={row.id}
                  startsOn={row.starts_on}
                  endsOn={row.ends_on}
                  status={statusOf(row)}
                  label={t("delegateRowLabel", { name: other?.full_name ?? other?.email ?? "—" })}
                  canRevoke
                />
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h2 className="font-disp text-lg font-semibold text-ink">{t("coveringForTitle")}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t("coveringForDescription")}</p>
        {!coveringFor || coveringFor.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">{t("emptyCoveringFor")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {coveringFor.map((row) => {
              const other = Array.isArray(row.users) ? row.users[0] : row.users;
              return (
                <DelegationRow
                  key={row.id}
                  locale={locale}
                  id={row.id}
                  startsOn={row.starts_on}
                  endsOn={row.ends_on}
                  status={statusOf(row)}
                  label={t("delegatorRowLabel", { name: other?.full_name ?? other?.email ?? "—" })}
                  canRevoke={false}
                />
              );
            })}
          </ul>
        )}
      </div>

      {allDelegations && (
        <div>
          <h2 className="font-disp text-lg font-semibold text-ink">{t("allTitle")}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t("allDescription")}</p>
          {allDelegations.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">{t("empty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {allDelegations.map((row) => (
                <DelegationRow
                  key={row.id}
                  locale={locale}
                  id={row.id}
                  startsOn={row.starts_on}
                  endsOn={row.ends_on}
                  status={statusOf(row)}
                  label={t("allRowLabel", {
                    delegator: row.delegator?.full_name ?? row.delegator?.email ?? "—",
                    delegate: row.delegate?.full_name ?? row.delegate?.email ?? "—",
                  })}
                  canRevoke
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
