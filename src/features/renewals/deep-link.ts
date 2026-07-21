// Único sitio que define el formato del path de un contrato — reusado por
// send-notifications.ts (buildContractDeepLink, emails/Teams, absoluto),
// renewal-track.tsx (pista del dashboard) y el calendario de renovaciones
// (Client Component). Sin ninguna otra dependencia a propósito: el
// calendario importaba antes esto desde send-notifications.ts, que arrastra
// el SDK de Resend y las plantillas de email al grafo del bundle de
// cliente — ver docs/DECISIONS.md.
export function buildContractPath(locale: string, vendorId: string, contractId: string): string {
  return `/${locale}/vendors/${vendorId}#contract-${contractId}`;
}
