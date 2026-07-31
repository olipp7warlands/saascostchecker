import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppLogo } from "@/components/catalog/app-logo";
import { ApprovalSteps, type ApprovalStepView } from "@/components/requests/approval-steps";
import { StatusTimeline } from "@/components/requests/status-timeline";
import { Pill } from "@/components/ui/pill";
import type { Role } from "@/features/auth/session";
import { getCurrentUserProfile } from "@/features/auth/session";
import { mapCatalogOverlapRow, type CatalogOverlapRpcRow } from "@/features/requests/catalog-overlap";
import { REQUEST_STATUS_TONE } from "@/features/requests/status-tone";
import type { PurchaseRequestStatus } from "@/features/requests/timeline";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { CatalogOverlapBanner } from "../catalog-overlap-banner";
import { RequestActions } from "./request-actions";

const VENDOR_MANAGER_ROLES = ["finance", "it_admin", "org_admin"];

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations("Requests");
  const tDetail = await getTranslations("Requests.detail");
  const profile = await getCurrentUserProfile();
  if (!profile) {
    notFound();
  }

  const supabase = await createClient();
  // RLS acota purchase_requests a requester_id = current_user_id() o a
  // finance/org_admin de la org (bloque 3.1b) — una solicitud fuera de esas
  // dos condiciones simplemente no existe para esta consulta.
  const [{ data: request, error }, { data: me }, { data: stepRows }, { data: actionRows }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select(
        "id, requester_id, vendor_name, estimated_annual_cost, currency, department_id, justification, alternatives_considered, status, rejection_reason, created_at, catalog_id, known_overlap, converted_vendor_id, converted_contract_id, saas_catalog(website), users(full_name, email)",
      )
      .eq("id", id)
      .single(),
    supabase.from("users").select("id").eq("auth_id", profile.authId).single(),
    // RLS de purchase_request_steps acota lo visible (aprobador del paso,
    // org_admin, o el propio solicitante) — sin filtro adicional aquí.
    // FK explícita: purchase_request_steps referencia a users dos veces
    // (resolved_approver_id y decided_by) — el embed implícito "users(...)"
    // es ambiguo para PostgREST sin especificar cuál.
    supabase
      .from("purchase_request_steps")
      .select(
        "step_order, status, approver_role, resolved_approver_id, resolved_via, resolved:users!purchase_request_steps_resolved_approver_id_fkey(full_name), decider:users!purchase_request_steps_decided_by_fkey(full_name)",
      )
      .eq("request_id", id)
      .order("step_order", { ascending: true }),
    // approval_actions guarda "actor real + en nombre de quién" (delegated_from_id,
    // bloque 3.2b) — se lee aparte porque es un log de movimientos, no el
    // snapshot de purchase_request_steps.
    supabase
      .from("approval_actions")
      .select("step_order, action, delegator:users!approval_actions_delegated_from_id_fkey(full_name)")
      .eq("request_id", id)
      .in("action", ["approved", "rejected"]),
  ]);

  if (error || !request) {
    notFound();
  }

  // Bloque 3.4: known_overlap es el hecho histórico ("el solicitante fue
  // avisado y siguió adelante"); el contenido del banner se recalcula en
  // vivo vía check_catalog_overlap() (mismo nivel de detalle según el rol
  // del viewer) en vez de guardar un snapshot que quedaría desactualizado.
  const overlapQuery = request.known_overlap && request.catalog_id
    ? await supabase.rpc("check_catalog_overlap", { p_catalog_id: request.catalog_id }).single()
    : null;
  const overlap = overlapQuery?.data
    ? mapCatalogOverlapRow(overlapQuery.data as CatalogOverlapRpcRow)
    : null;

  const departmentQuery = request.department_id
    ? await supabase.from("departments").select("name").eq("id", request.department_id).single()
    : null;
  const departmentName = departmentQuery?.data?.name ?? null;

  const catalogEntry = Array.isArray(request.saas_catalog)
    ? request.saas_catalog[0]
    : request.saas_catalog;
  const requester = Array.isArray(request.users) ? request.users[0] : request.users;

  const actionByStep = new Map(
    (actionRows ?? []).map((row) => {
      const delegator = Array.isArray(row.delegator) ? row.delegator[0] : row.delegator;
      return [row.step_order, delegator?.full_name ?? null];
    }),
  );

  const steps: ApprovalStepView[] = (stepRows ?? []).map((row) => {
    const approver = Array.isArray(row.resolved) ? row.resolved[0] : row.resolved;
    const decider = Array.isArray(row.decider) ? row.decider[0] : row.decider;
    return {
      stepOrder: row.step_order,
      status: row.status as ApprovalStepView["status"],
      approverRole: row.approver_role as Role | null,
      approverName: approver?.full_name ?? null,
      resolvedVia: row.resolved_via as ApprovalStepView["resolvedVia"],
      decidedByName: decider?.full_name ?? null,
      delegatedFromName: actionByStep.get(row.step_order) ?? null,
    };
  });

  const activeStepRow = (stepRows ?? []).find(
    (row) => row.status === "pending" || row.status === "escalated_to_org_admin",
  );
  // El delegado vigente del aprobador resuelto también puede actuar (bloque
  // 3.2b, aditivo — el original no pierde su capacidad): is_active_delegate_of()
  // es relativo al caller (auth.uid()), así que basta con preguntar "¿soy yo
  // delegado activo de resolved_approver_id?" sin exponer relaciones ajenas.
  const isActiveDelegate =
    !!activeStepRow?.resolved_approver_id &&
    activeStepRow.resolved_approver_id !== me?.id &&
    (
      await supabase.rpc("is_active_delegate_of", {
        p_delegator_user_id: activeStepRow.resolved_approver_id,
      })
    ).data === true;
  const canApprove =
    !!activeStepRow &&
    (activeStepRow.resolved_approver_id === me?.id ||
      (activeStepRow.approver_role !== null && activeStepRow.approver_role === profile.role) ||
      isActiveDelegate);
  const isRequester = me?.id === request.requester_id;
  const canCreateVendor = VENDOR_MANAGER_ROLES.includes(profile.role);

  const status = request.status as PurchaseRequestStatus;
  const costFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: request.currency,
    maximumFractionDigits: 0,
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });


  return (
    <div className="mx-auto max-w-2xl">
      <a
        href={`/${locale}/requests`}
        className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {tDetail("back")}
      </a>

      <div className="mt-3 flex items-center gap-3">
        <AppLogo domain={catalogEntry?.website ?? null} name={request.vendor_name} size={40} />
        <div>
          <h1 className="font-disp text-2xl font-semibold tracking-tight text-ink sm:text-[26px]">
            {request.vendor_name}
          </h1>
          <p className="text-xs text-ink-soft">
            {tDetail("requestedOn", { date: dateFormatter.format(new Date(request.created_at)) })}
          </p>
        </div>
        <Pill tone={REQUEST_STATUS_TONE[status]} className="ml-auto">
          {t(`status.${status}`)}
        </Pill>
      </div>

      {overlap && (
        <div className="mt-4">
          <CatalogOverlapBanner
            overlap={overlap}
            requestedAnnualCost={Number(request.estimated_annual_cost)}
            requestedCurrency={request.currency}
            variant="detail"
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("costLabel")}
            </p>
            <p className="num mt-0.5 text-lg font-semibold text-ink">
              {costFormatter.format(Number(request.estimated_annual_cost))}
            </p>
          </div>
          {canApprove && !isRequester && (
            <div>
              <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                {tDetail("requesterLabel")}
              </p>
              <p className="mt-0.5 text-sm text-ink">{requester?.full_name ?? requester?.email ?? "—"}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("departmentLabel")}
            </p>
            <p className="mt-0.5 text-sm text-ink">{departmentName ?? tDetail("noDepartment")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
              {tDetail("justificationLabel")}
            </p>
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{request.justification}</p>
          </div>
          {request.alternatives_considered && (
            <div>
              <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                {tDetail("alternativesLabel")}
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">
                {request.alternatives_considered}
              </p>
            </div>
          )}
          {status === "rejected" && request.rejection_reason && (
            <div>
              <p className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                {tDetail("rejectionReasonLabel")}
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{request.rejection_reason}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface p-4">
            <StatusTimeline status={status} />
          </div>

          <ApprovalSteps steps={steps} />

          <RequestActions
            locale={locale}
            requestId={request.id}
            status={status}
            canApprove={canApprove}
            isRequester={isRequester}
          />

          {status === "approved" && canCreateVendor && !request.converted_contract_id && (
            <a
              href={`/${locale}/requests/${request.id}/convert`}
              className="inline-flex h-9 items-center justify-center rounded-btn bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#2A2E30]"
            >
              {tDetail("actions.createVendorLink")}
            </a>
          )}

          {request.converted_contract_id &&
            (canCreateVendor ? (
              <a
                href={`/${locale}/vendors/${request.converted_vendor_id}#contract-${request.converted_contract_id}`}
                className="inline-flex h-9 items-center justify-center rounded-btn border border-input bg-transparent px-4 text-sm font-semibold text-ink hover:bg-muted/40"
              >
                {tDetail("actions.viewContract")}
              </a>
            ) : (
              <p className="text-xs text-ink-soft">{tDetail("convertedBadge")}</p>
            ))}
        </div>
      </div>
    </div>
  );
}
