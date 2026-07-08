import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogCategory, SaasCatalogEntry } from "./types";

type SearchRow = {
  id: string;
  name: string;
  aliases: string[] | null;
  category: string;
  website: string;
  logo_url: string | null;
  verified: boolean;
};

export async function searchSaasCatalog(
  supabase: SupabaseClient,
  query: string,
  limit = 8,
): Promise<SaasCatalogEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const { data, error } = await supabase.rpc("search_saas_catalog", {
    p_query: trimmed,
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SearchRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    category: row.category as CatalogCategory,
    website: row.website,
    logoUrl: row.logo_url,
    verified: row.verified,
  }));
}
