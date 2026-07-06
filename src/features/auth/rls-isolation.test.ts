// @vitest-environment node
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Este test crea usuarios/orgs reales vía signUp(). Solo debe correr contra la
// instancia LOCAL de Supabase — nunca contra el proyecto remoto.
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `rls-isolation.test.ts apunta a "${url}", que no es la instancia local de Supabase. Aborta.`,
  );
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

type TestTenant = { client: SupabaseClient; userId: string; email: string };

async function signUpOrg(label: string): Promise<TestTenant> {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const suffix = randomSuffix();
  const email = `${label}-${suffix}@example.test`;

  const { data, error } = await client.auth.signUp({
    email,
    password: "Test1234!",
    options: {
      data: {
        full_name: `${label} Owner`,
        org_name: `${label} Inc`,
        org_slug: `${label}-${suffix}`,
        default_currency: "EUR",
        locale: "es",
      },
    },
  });

  if (error || !data.user) {
    throw error ?? new Error("signUp did not return a user");
  }

  return { client, userId: data.user.id, email };
}

describe("Aislamiento RLS entre tenants (bloque 0.2)", () => {
  let orgA: TestTenant;
  let orgB: TestTenant;

  beforeAll(async () => {
    [orgA, orgB] = await Promise.all([signUpOrg("org-a"), signUpOrg("org-b")]);
  });

  it("un usuario ve su propio perfil", async () => {
    const { data, error } = await orgA.client
      .from("users")
      .select("email")
      .eq("auth_id", orgA.userId)
      .single();

    expect(error).toBeNull();
    expect(data?.email).toBe(orgA.email);
  });

  it("un usuario de la org A NO puede leer el perfil del usuario de la org B", async () => {
    const { data, error } = await orgA.client
      .from("users")
      .select("*")
      .eq("email", orgB.email);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("un usuario de la org A NO puede leer la fila organizations de la org B", async () => {
    const { data: ownProfile } = await orgB.client
      .from("users")
      .select("org_id")
      .eq("auth_id", orgB.userId)
      .single();

    const { data, error } = await orgA.client
      .from("organizations")
      .select("*")
      .eq("id", ownProfile!.org_id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("org_admin de la org A no puede revocar una invitación de la org B (aislamiento también en las RPCs)", async () => {
    const { data: invitationId, error: createError } = await orgB.client.rpc(
      "create_invitation",
      {
        p_email: "someone@example.test",
        p_role: "employee",
        p_token_hash: randomSuffix().padEnd(64, "0"),
        p_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    expect(createError).toBeNull();

    const { error: revokeError } = await orgA.client.rpc("revoke_invitation", {
      p_invitation_id: invitationId,
    });

    expect(revokeError).not.toBeNull();
    expect(revokeError?.message).toMatch(/invitation not found/i);
  });
});
