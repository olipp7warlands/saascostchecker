// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Inserta/borra filas sintéticas del catálogo con el service_role (bypassa
// RLS). No es un test de aislamiento multi-tenant (saas_catalog no tiene
// org_id) — el guard es solo para no tocar nunca el proyecto remoto con
// escrituras de prueba.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `search.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
  );
}

const admin: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

describe("search_saas_catalog — ranking (bloque 1.1)", () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const token = `zzzq${suffix}`;
  const insertedIds: string[] = [];

  // Cuatro filas diseñadas para caer cada una en un tier distinto del
  // ranking, sin depender del contenido real del seed (que puede cambiar).
  const rows = [
    { name: `${token} Alpha`, category: "other", website: "zzzalpha.test", aliases: [] as string[] },
    { name: "Beta Company", category: "other", website: "zzzbeta.test", aliases: [`${token} Beta Alias`] },
    { name: `Gamma ${token} Corp`, category: "other", website: "zzzgamma.test", aliases: [] as string[] },
    { name: "Delta Company", category: "other", website: "zzzdelta.test", aliases: [`Some Payment ${token} Descriptor`] },
  ];

  beforeAll(async () => {
    for (const row of rows) {
      const { data, error } = await admin
        .from("saas_catalog")
        .insert({ ...row, verified: true })
        .select("id")
        .single();
      if (error || !data) {
        throw error ?? new Error("insert did not return a row");
      }
      insertedIds.push(data.id);
    }
  });

  afterAll(async () => {
    if (insertedIds.length > 0) {
      await admin.from("saas_catalog").delete().in("id", insertedIds);
    }
  });

  it("ordena nombre-prefijo > alias-prefijo > nombre-contains > alias-contains", async () => {
    const { data, error } = await admin.rpc("search_saas_catalog", {
      p_query: token,
      p_limit: 10,
    });

    expect(error).toBeNull();
    const names = (data ?? []).map((row: { name: string }) => row.name);

    expect(names).toEqual([`${token} Alpha`, "Beta Company", `Gamma ${token} Corp`, "Delta Company"]);
  });

  it("no devuelve nada para una query vacía", async () => {
    const { data, error } = await admin.rpc("search_saas_catalog", { p_query: "   ", p_limit: 10 });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("'figm' sugiere Figma como primer resultado en menos de 150ms", async () => {
    const start = performance.now();
    const { data, error } = await admin.rpc("search_saas_catalog", {
      p_query: "figm",
      p_limit: 8,
    });
    const elapsedMs = performance.now() - start;

    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe("Figma");
    expect(elapsedMs).toBeLessThan(150);
  });
});
