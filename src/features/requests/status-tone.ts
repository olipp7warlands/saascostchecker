import type { PillTone } from "@/components/ui/pill";
import type { PurchaseRequestStatus } from "./timeline";

export const REQUEST_STATUS_TONE: Record<PurchaseRequestStatus, PillTone> = {
  draft: "neutral",
  pending: "amber",
  approved: "green",
  rejected: "red",
  purchased: "green",
  cancelled: "neutral",
};
