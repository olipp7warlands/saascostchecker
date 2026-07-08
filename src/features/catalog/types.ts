export const CATALOG_CATEGORIES = [
  "crm",
  "marketing",
  "sales",
  "design",
  "productivity",
  "communication",
  "devtools",
  "observability",
  "security",
  "analytics",
  "hr",
  "finance",
  "support",
  "project_management",
  "video",
  "other",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export type SaasCatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  category: CatalogCategory;
  website: string;
  logoUrl: string | null;
  verified: boolean;
};
