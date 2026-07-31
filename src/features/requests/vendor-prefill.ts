// Bloque 3.1b/3.3: construye el query string de precarga que consume
// /vendors/new al llegar desde "Crear vendor/contrato" de una solicitud
// aprobada. Compartido entre la ficha de solicitud, la página intersticial
// de conversión (/requests/[id]/convert) y su redirect de "sin match" —
// un único sitio que decide qué parámetros viajan.
export function buildVendorPrefillHref(
  locale: string,
  request: {
    id: string;
    catalogId: string | null;
    vendorName: string;
    departmentId: string | null;
    estimatedAnnualCost: number;
    currency: string;
  },
): string {
  const params = new URLSearchParams();
  if (request.catalogId) params.set("catalog_id", request.catalogId);
  params.set("vendor_name", request.vendorName);
  if (request.departmentId) params.set("department_id", request.departmentId);
  params.set("cost", String(request.estimatedAnnualCost));
  params.set("currency", request.currency);
  params.set("source_request_id", request.id);
  return `/${locale}/vendors/new?${params.toString()}`;
}
