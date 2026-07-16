import type { BillingCycle } from "@/features/vendors/types";
import { ContractSeats, type SeatRow } from "./contract-seats";

type Contract = {
  id: string;
  name: string;
  cost_amount: number;
  currency: string;
  billing_cycle: string;
  seats_purchased: number | null;
};
type Member = { id: string; full_name: string | null; email: string };

export function SeatsTab({
  contracts,
  seatsByContract,
  members,
}: {
  contracts: Contract[];
  seatsByContract: Record<string, SeatRow[]>;
  members: Member[];
}) {
  if (contracts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {contracts.map((contract) => (
        <div key={contract.id} className="rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">{contract.name}</h3>
          <ContractSeats
            contractId={contract.id}
            costAmount={contract.cost_amount}
            currency={contract.currency}
            billingCycle={contract.billing_cycle as BillingCycle}
            seatsPurchased={contract.seats_purchased}
            seats={seatsByContract[contract.id] ?? []}
            members={members}
          />
        </div>
      ))}
    </div>
  );
}
