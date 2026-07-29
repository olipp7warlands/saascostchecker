export type PurchaseRequestStatus = "draft" | "pending" | "approved" | "rejected" | "purchased";

export type TimelineStepKey = "submitted" | "review" | "decision" | "purchased";
export type TimelineStepState = "done" | "active" | "upcoming" | "rejected";
export type TimelineStep = { key: TimelineStepKey; state: TimelineStepState };

// El paso "purchased" se muestra siempre como parte del recorrido completo,
// EXCEPTO cuando la solicitud ya está rechazada — en ese caso ese paso es
// genuinamente inalcanzable, no solo "todavía no". El resto de estados
// siempre expone las 4 etapas por adelantado (las futuras en "upcoming") en
// vez de ir añadiendo pasos según el estado actual, para que el recorrido
// completo sea visible desde el principio.
export function getTimelineSteps(status: PurchaseRequestStatus): TimelineStep[] {
  const submitted: TimelineStepState = status === "draft" ? "upcoming" : "done";
  const review: TimelineStepState =
    status === "draft" ? "upcoming" : status === "pending" ? "active" : "done";

  if (status === "rejected") {
    return [
      { key: "submitted", state: submitted },
      { key: "review", state: review },
      { key: "decision", state: "rejected" },
    ];
  }

  const decisionDone = status === "approved" || status === "purchased";

  return [
    { key: "submitted", state: submitted },
    { key: "review", state: review },
    { key: "decision", state: decisionDone ? "done" : "upcoming" },
    { key: "purchased", state: status === "purchased" ? "done" : "upcoming" },
  ];
}
