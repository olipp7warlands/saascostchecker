import type { BillingCycle } from "@/features/vendors/types";

// Bloque 3.4 — forma que devuelve check_catalog_overlap() (RPC), ya tipada
// del lado TS. `cost_amount`/`currency`/`billing_cycle` llegan null cuando el
// caller no es MANAGER_ROLES (finance/it_admin/org_admin) — la RPC decide el
// nivel server-side, esto solo tipa lo que puede llegar.
export type CatalogOverlapContractRow = {
  vendor_id: string;
  vendor_name: string;
  vendor_website: string;
  owner_name: string | null;
  department_name: string | null;
  company_name: string | null;
  cost_amount: number | string | null;
  currency: string | null;
  billing_cycle: BillingCycle | null;
};

export type CatalogOverlapContract = {
  vendorId: string;
  vendorName: string;
  vendorWebsite: string;
  ownerName: string | null;
  departmentName: string | null;
  companyName: string | null;
  costAmount: number | null;
  currency: string | null;
  billingCycle: BillingCycle | null;
};

export type CatalogOverlapResult = {
  hasOverlap: boolean;
  activeContractCount: number;
  contracts: CatalogOverlapContract[];
};

// Forma cruda de la fila que devuelve check_catalog_overlap() (RPC). El
// cliente de Supabase de este proyecto no usa un generic Database (ver
// src/lib/supabase/server.ts), así que `.rpc(...).single()` infiere `{}` —
// mismo idioma que ya usa dashboard/page.tsx para tipar filas de RPC: castear
// explícitamente en el punto de llamada en vez de añadir un generic global.
export type CatalogOverlapRpcRow = {
  has_overlap: boolean;
  active_contract_count: number;
  contracts: CatalogOverlapContractRow[] | null;
};

export function mapCatalogOverlapRow(row: CatalogOverlapRpcRow): CatalogOverlapResult {
  return {
    hasOverlap: row.has_overlap,
    activeContractCount: row.active_contract_count,
    contracts: (row.contracts ?? []).map((c) => ({
      vendorId: c.vendor_id,
      vendorName: c.vendor_name,
      vendorWebsite: c.vendor_website,
      ownerName: c.owner_name,
      departmentName: c.department_name,
      companyName: c.company_name,
      costAmount: c.cost_amount !== null ? Number(c.cost_amount) : null,
      currency: c.currency,
      billingCycle: c.billing_cycle,
    })),
  };
}
