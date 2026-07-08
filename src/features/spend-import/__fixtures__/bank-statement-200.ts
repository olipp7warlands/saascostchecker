// Fixture del criterio de aceptación de TASKS.md bloque 1.3: "CSV bancario
// de 200 filas importado y >=70% auto-sugerido correctamente con el seed
// demo". 150 filas de gasto SaaS real (50 vendors del seed x 3 variantes de
// ruido bancario español/UE) + 50 filas de gasto NO-SaaS (alquiler, nómina,
// suministros, viajes...) que deben quedar correctamente SIN sugerencia —
// mezclar ambas evita inflar el porcentaje con un CSV 100% "matcheable".
//
// expectedVendor: nombre exacto de saas_catalog.name esperado (o null si la
// fila NO debe recibir ninguna sugerencia).

export type FixtureRow = { rawDescription: string; expectedVendor: string | null };

const CITIES = [
  "MADRID ES",
  "BARCELONA ES",
  "VALENCIA ES",
  "SEVILLA ES",
  "BILBAO ES",
  "SAN FRANCISCO US",
  "DUBLIN IE",
  "LONDON UK",
  "AMSTERDAM NL",
  "BERLIN DE",
];

const REF_NUMBERS = ["4857392", "1123456", "9988771", "5502234", "7765432"];

// Nombres reales confirmados en supabase/migrations/0004_saas_catalog_seed.sql
const SAAS_VENDORS = [
  "15Five",
  "1Password",
  "AWS",
  "Adobe Creative Cloud",
  "Airtable",
  "Ahrefs",
  "Asana",
  "Auth0",
  "Basecamp",
  "BambooHR",
  "Box",
  "Buffer",
  "Calendly",
  "Chargebee",
  "CircleCI",
  "Cloudflare",
  "Coda",
  "Confluence",
  "Datadog",
  "Deel",
  "Descript",
  "Dialpad",
  "DigitalOcean",
  "Discord",
  "Docker",
  "Dropbox",
  "Figma",
  "GitHub",
  "Grammarly",
  "Loom",
  "Miro",
  "Notion",
  "Shopify",
  "Slack",
  "Stripe",
  "Twilio",
  "Typeform",
  "Zendesk",
  "Zoom",
  "Bitbucket",
  "Bitwarden",
  "Brex",
  "Buildkite",
  "Bugsnag",
  "Chorus",
  "Clari",
  "Clay",
  "ClickUp",
  "Clio",
  "Coupa",
];

const NON_SAAS_ROWS = [
  "NOMINA EMPRESA SL ENERO",
  "RECIBO ALQUILER OFICINA MADRID",
  "SEGURIDAD SOCIAL TGSS",
  "COMPRA TARJETA MERCADONA MADRID ES",
  "RESTAURANTE EL RINCON BARCELONA",
  "IBERIA LINEAS AEREAS",
  "RENFE AVE BILLETE",
  "AGENCIA TRIBUTARIA IVA",
  "SUMINISTRO ELECTRICO ENDESA",
  "AGUAS DE MADRID",
  "CORREOS ESPANA ENVIO",
  "FARMACIA GUADALAJARA",
  "TAXI MADRID CENTRO",
  "GASOLINERA REPSOL",
  "SEGURO AUTO MAPFRE",
  "ALQUILER VEHICULO EUROPCAR",
  "HOTEL NH COLLECTION",
  "PARKING SABA CENTRO",
  "LIMPIEZA OFICINA SERVICIOS SL",
  "MATERIAL OFICINA ESTABLECIMIENTOS",
  "CATERING EVENTO CORPORATIVO",
  "TRANSFERENCIA A FAVOR DE JUAN PEREZ GARCIA",
  "BIZUM A FAVOR DE MARIA LOPEZ",
  "COMISION MANTENIMIENTO CUENTA",
  "INTERESES CUENTA AHORRO",
  "RECIBO SEGURO HOGAR MAPFRE",
  "CUOTA COLEGIO PROFESIONAL",
  "DONATIVO CRUZ ROJA ESPANOLA",
  "COMPRA TARJETA CARREFOUR MADRID",
  "COMPRA TARJETA EL CORTE INGLES",
  "PEAJE AUTOPISTA",
  "ITV VEHICULO EMPRESA",
  "REPARACION VEHICULO TALLER",
  "MUDANZA OFICINA TRANSPORTES",
  "CONSULTORIA LEGAL ABOGADOS SL",
  "GESTORIA FISCAL CONTABLE",
  "IMPRENTA TARJETAS VISITA",
  "FLORISTERIA EVENTO OFICINA",
  "CATERING COMIDA EMPRESA",
  "CUOTA CAMARA COMERCIO",
  "SEGURO RESPONSABILIDAD CIVIL",
  "ALQUILER SALA REUNIONES",
  "MOBILIARIO OFICINA IKEA",
  "FONTANERO REPARACION OFICINA",
  "ELECTRICISTA INSTALACION OFICINA",
  "PUBLICIDAD PRENSA LOCAL",
  "REVISTA SECTOR SUSCRIPCION",
  "COMEDOR EMPRESA MENU DIARIO",
  "VIGILANCIA SEGURIDAD OFICINA",
  "RECOGIDA BASURA INDUSTRIAL",
];

function buildSaasRows(): FixtureRow[] {
  const rows: FixtureRow[] = [];
  SAAS_VENDORS.forEach((name, index) => {
    const upper = name.toUpperCase();
    const city = CITIES[index % CITIES.length];
    const ref = REF_NUMBERS[index % REF_NUMBERS.length];
    const refAlt = REF_NUMBERS[(index + 2) % REF_NUMBERS.length];

    // Variante A: descriptor de tarjeta + ruido de ubicación al final.
    rows.push({ rawDescription: `${upper} ${city}`, expectedVendor: name });
    // Variante B: boilerplate bancario español líder + referencia numérica.
    rows.push({ rawDescription: `COMPRA TARJETA ${upper} ${ref}`, expectedVendor: name });
    // Variante C: la mitad vía PayPal (agregador de pago), la otra mitad con
    // solo una referencia numérica final.
    rows.push(
      index % 2 === 0
        ? { rawDescription: `PAYPAL *${upper}`, expectedVendor: name }
        : { rawDescription: `${upper} ${refAlt}`, expectedVendor: name },
    );
  });
  return rows;
}

function buildNonSaasRows(): FixtureRow[] {
  return NON_SAAS_ROWS.map((rawDescription) => ({ rawDescription, expectedVendor: null }));
}

export const BANK_STATEMENT_200: FixtureRow[] = [...buildSaasRows(), ...buildNonSaasRows()];
