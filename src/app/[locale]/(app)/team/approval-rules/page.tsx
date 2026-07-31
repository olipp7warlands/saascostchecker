import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { AddDepartmentOverride } from "./add-department-override";
import { ApprovalRuleScopeEditor, type TierData } from "./approval-rule-scope-editor";

type RuleRow = {
  department_id: string | null;
  min_amount: string | number;
  max_amount: string | number | null;
  step_order: number;
  approver_type: string;
  approver_role: string | null;
  approver_user_id: string | null;
};

function groupByScope(rules: RuleRow[]): { departmentId: string | null; tiers: TierData[] }[] {
  const byScope = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const key = rule.department_id ?? "global";
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key)!.push(rule);
  }

  const scopes: { departmentId: string | null; tiers: TierData[] }[] = [];

  for (const [key, rows] of byScope) {
    const tiersMap = new Map<string, RuleRow[]>();
    for (const row of rows) {
      const tierKey = `${row.min_amount}-${row.max_amount}`;
      if (!tiersMap.has(tierKey)) tiersMap.set(tierKey, []);
      tiersMap.get(tierKey)!.push(row);
    }

    const tiers = Array.from(tiersMap.values())
      .sort((a, b) => Number(a[0].min_amount) - Number(b[0].min_amount))
      .map((stepRows) => ({
        maxAmount: stepRows[0].max_amount === null ? null : Number(stepRows[0].max_amount),
        steps: [...stepRows]
          .sort((a, b) => a.step_order - b.step_order)
          .map((row) => ({
            approverType: row.approver_type as TierData["steps"][number]["approverType"],
            approverRole: row.approver_role,
            approverUserId: row.approver_user_id,
          })),
      }));

    scopes.push({ departmentId: key === "global" ? null : key, tiers });
  }

  scopes.sort((a, b) => (a.departmentId === null ? -1 : b.departmentId === null ? 1 : 0));
  return scopes;
}

export default async function ApprovalRulesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Team.approvalRules");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: profile } = await supabase.from("users").select("role").eq("auth_id", user.id).single();

  if (!profile || profile.role !== "org_admin") {
    return <p className="text-sm text-ink-soft">{t("forbidden")}</p>;
  }

  const [{ data: rules }, { data: departments }, { data: members }] = await Promise.all([
    supabase
      .from("approval_rules")
      .select("department_id, min_amount, max_amount, step_order, approver_type, approver_role, approver_user_id"),
    supabase.from("departments").select("id, name").order("name", { ascending: true }),
    supabase.from("users").select("id, full_name, email").order("full_name", { ascending: true }),
  ]);

  const scopes = groupByScope(rules ?? []);
  const departmentNames = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const departmentsWithoutOverride = (departments ?? []).filter(
    (d) => !scopes.some((s) => s.departmentId === d.id),
  );
  const globalScope = scopes.find((s) => s.departmentId === null);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink">{t("title")}</h1>
        <p className="mt-1 text-sm text-warning">{t("immutabilityNotice")}</p>
      </div>

      {scopes.map((scope) => (
        <ApprovalRuleScopeEditor
          key={scope.departmentId ?? "global"}
          locale={locale}
          departmentId={scope.departmentId}
          departmentName={scope.departmentId ? (departmentNames.get(scope.departmentId) ?? null) : null}
          initialTiers={scope.tiers}
          members={members ?? []}
        />
      ))}

      {departmentsWithoutOverride.length > 0 && (
        <AddDepartmentOverride
          locale={locale}
          departments={departmentsWithoutOverride}
          globalTiers={globalScope?.tiers ?? []}
          members={members ?? []}
        />
      )}
    </div>
  );
}
