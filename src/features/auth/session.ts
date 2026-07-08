import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "employee" | "manager" | "finance" | "it_admin" | "org_admin";

export type CurrentUserProfile = {
  authId: string;
  email: string;
  fullName: string | null;
  role: Role;
  orgId: string;
  orgName: string;
};

export const getCurrentUserProfile = cache(async (): Promise<CurrentUserProfile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, org_id, full_name")
    .eq("auth_id", user.id)
    .single();

  if (!profile) {
    return null;
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.org_id)
    .single();

  return {
    authId: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    role: profile.role as Role,
    orgId: profile.org_id,
    orgName: organization?.name ?? "",
  };
});
