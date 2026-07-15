// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { BANK_STATEMENT_200 } from "./__fixtures__/bank-statement-200";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// best_catalog_match() solo lee saas_catalog (global, sin org_id) — el
// service_role evita tener que dar de alta una org/usuario real solo para
// ejercitar el matcher. El guard es igualmente obligatorio: nunca correr
// contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `import-acceptance.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
  );
}

const admin: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const AUTO_SUGGEST_THRESHOLD = 0.4;

describe("Criterio de aceptación de TASKS.md 1.3: CSV de 200 filas, >=70% auto-sugerido correctamente", () => {
  it("acierta en al menos el 70% de las 220 filas del fixture (positivos y negativos, incluida la ampliación de IA de 1.1)", async () => {
    // 220 filas x 2 round-trips (best_catalog_match + lookup del nombre) a la
    // instancia local de Supabase superan el timeout por defecto de 5s.
    expect(BANK_STATEMENT_200).toHaveLength(220);

    let correct = 0;
    const failures: string[] = [];

    for (const row of BANK_STATEMENT_200) {
      const { data, error } = await admin.rpc("best_catalog_match", {
        p_raw_description: row.rawDescription,
      });
      expect(error).toBeNull();

      const match = (data ?? [])[0] as { catalog_id: string; confidence: number } | undefined;
      const confidence = match ? Number(match.confidence) : 0;
      const suggested = confidence >= AUTO_SUGGEST_THRESHOLD ? match!.catalog_id : null;

      let suggestedName: string | null = null;
      if (suggested) {
        const { data: catalogEntry } = await admin
          .from("saas_catalog")
          .select("name")
          .eq("id", suggested)
          .single();
        suggestedName = catalogEntry?.name ?? null;
      }

      const isCorrect = row.expectedVendor === null ? suggestedName === null : suggestedName === row.expectedVendor;

      if (isCorrect) {
        correct += 1;
      } else {
        failures.push(
          `"${row.rawDescription}" esperado=${row.expectedVendor ?? "(ninguno)"} obtenido=${suggestedName ?? "(ninguno)"} confidence=${confidence.toFixed(2)}`,
        );
      }
    }

    const pct = (correct / BANK_STATEMENT_200.length) * 100;
    console.log(`Auto-sugerido correctamente: ${correct}/${BANK_STATEMENT_200.length} (${pct.toFixed(1)}%)`);
    if (failures.length > 0) {
      console.log("Fallos:\n" + failures.join("\n"));
    }

    expect(pct).toBeGreaterThanOrEqual(70);
  }, 30_000);
});
