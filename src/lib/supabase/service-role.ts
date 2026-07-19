import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Primer uso de SUPABASE_SERVICE_ROLE_KEY en código de aplicación (hasta
// ahora solo en tests, ver renewal-alerts.test.ts) — bypassa RLS por
// completo, solo debe usarse desde contextos server-only ya autenticados por
// otro medio (la ruta API de cron, protegida por secreto compartido).
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
