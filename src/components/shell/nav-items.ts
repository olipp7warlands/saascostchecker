import {
  Building2,
  ClipboardCheck,
  GitMerge,
  LayoutDashboard,
  RefreshCw,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/features/auth/session";

export type NavItemKey =
  | "dashboard"
  | "vendors"
  | "renewals"
  | "requests"
  | "importSpend"
  | "reconciliation"
  | "teamRules";

export type NavItem = {
  key: NavItemKey;
  href: string | null;
  icon: LucideIcon;
  roles: Role[] | "all";
  section?: "data" | "settings";
  bottomNav?: boolean;
};

// "teamRules" (0.2/0.3), "dashboard" (0.4) y "vendors" (1.2) tienen página
// real. El resto pertenece a fases 1-3 sin implementar todavía: se muestran
// como placeholders deshabilitados para mantener paridad estructural con el
// mockup (ver docs/DECISIONS.md).
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard, roles: "all", bottomNav: true },
  {
    key: "vendors",
    href: "/vendors",
    icon: Building2,
    roles: ["finance", "it_admin", "org_admin"],
    bottomNav: true,
  },
  {
    key: "renewals",
    href: null,
    icon: RefreshCw,
    roles: ["finance", "it_admin", "org_admin"],
    bottomNav: true,
  },
  { key: "requests", href: null, icon: ClipboardCheck, roles: "all", bottomNav: true },
  {
    key: "importSpend",
    href: null,
    icon: Upload,
    roles: ["finance", "it_admin", "org_admin"],
    section: "data",
  },
  {
    key: "reconciliation",
    href: null,
    icon: GitMerge,
    roles: ["finance", "it_admin", "org_admin"],
    section: "data",
  },
  {
    key: "teamRules",
    href: "/team/members",
    icon: Users,
    roles: ["org_admin"],
    section: "settings",
  },
];

export function isNavItemVisible(item: NavItem, role: Role): boolean {
  return item.roles === "all" || item.roles.includes(role);
}

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => isNavItemVisible(item, role));
}
