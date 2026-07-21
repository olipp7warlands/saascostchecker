import type { createClient } from "@/lib/supabase/server";
import type { DashboardContract, DashboardVendor } from "./types";

// Query vendor→contracts→departments/companies compartida por el dashboard y
// el calendario de renovaciones — un solo sitio para no duplicar el select
// anidado ni el mapeo snake_case→camelCase.
export async function fetchDashboardContracts(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ vendors: DashboardVendor[]; contracts: DashboardContract[] }> {
  const { data: vendorRows } = await supabase
    .from("vendors")
    .select(
      "id, name, website, status, owner_user_id, contracts(id, cost_amount, currency, billing_cycle, seats_purchased, renewal_date, auto_renews, cancellation_notice_days, status, department_id, departments(name), company_id, companies(name), seat_assignments(id, last_seen_active_at))",
    );

  const vendors: DashboardVendor[] = (vendorRows ?? []).map((vendor) => ({
    id: vendor.id,
    status: vendor.status,
    ownerUserId: vendor.owner_user_id,
  }));

  const contracts: DashboardContract[] = (vendorRows ?? []).flatMap((vendor) =>
    (vendor.contracts ?? []).map((contract) => {
      const department = Array.isArray(contract.departments)
        ? contract.departments[0]
        : contract.departments;
      const company = Array.isArray(contract.companies) ? contract.companies[0] : contract.companies;
      return {
        id: contract.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorWebsite: vendor.website,
        costAmount: Number(contract.cost_amount),
        currency: contract.currency,
        billingCycle: contract.billing_cycle,
        seatsPurchased: contract.seats_purchased,
        activeSeats: (contract.seat_assignments ?? []).filter(
          (seat) => seat.last_seen_active_at !== null,
        ).length,
        renewalDate: contract.renewal_date,
        autoRenews: contract.auto_renews,
        cancellationNoticeDays: contract.cancellation_notice_days,
        status: contract.status,
        departmentId: contract.department_id,
        departmentName: department?.name ?? null,
        companyId: contract.company_id,
        companyName: company?.name ?? null,
      };
    }),
  );

  return { vendors, contracts };
}
