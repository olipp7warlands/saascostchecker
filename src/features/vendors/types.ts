import type { CatalogCategory } from "@/features/catalog/types";

export type VendorStatus = "active" | "inactive" | "trial";
export type BillingCycle = "monthly" | "annual" | "one_time";
export type ContractStatus = "active" | "cancelled";

export type Vendor = {
  id: string;
  catalogId: string | null;
  name: string;
  website: string;
  category: CatalogCategory;
  status: VendorStatus;
  ownerUserId: string | null;
  isCustom: boolean;
  notes: string | null;
};

export type Contract = {
  id: string;
  vendorId: string;
  name: string;
  costAmount: number;
  currency: string;
  billingCycle: BillingCycle;
  seatsPurchased: number | null;
  startDate: string;
  renewalDate: string;
  autoRenews: boolean;
  cancellationNoticeDays: number;
  documentUrl: string | null;
  status: ContractStatus;
  departmentId: string | null;
  companyId: string | null;
};

export type SeatAssignment = {
  id: string;
  contractId: string;
  userId: string;
  source: "manual" | "sso_sync";
  lastSeenActiveAt: string | null;
};
