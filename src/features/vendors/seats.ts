export type UtilizationTone = "success" | "warning";

// % redondeado de asientos activos sobre comprados. seats_purchased=0 (o
// negativo, no debería ocurrir por el check de la migración) se trata como
// "nada que utilizar" en vez de dividir por cero.
export function seatUtilizationPct(activeSeats: number, seatsPurchased: number): number {
  if (seatsPurchased <= 0) return 0;
  return Math.round((activeSeats / seatsPurchased) * 100);
}

// teal >=70%, ámbar por debajo (umbral literal de docs/TASKS.md 1.4 y del
// mockup: HubSpot 60% y Notion 63% en ámbar, Salesforce 80% en teal).
export function utilizationTone(pct: number): UtilizationTone {
  return pct < 70 ? "warning" : "success";
}

// € desperdiciado estimado = coste por asiento (coste anualizado / asientos
// comprados) × asientos comprados que no están activos. Si hay más
// asignados que comprados, no hay asientos "idle" que desperdiciar (se
// clampa a 0) — el exceso se señala aparte (assign_seat over_capacity), no
// aquí.
export function wastedSeatCost(
  annualCost: number,
  seatsPurchased: number,
  activeSeats: number,
): number {
  if (seatsPurchased <= 0) return 0;
  const costPerSeat = annualCost / seatsPurchased;
  const idleSeats = Math.max(seatsPurchased - activeSeats, 0);
  return costPerSeat * idleSeats;
}
