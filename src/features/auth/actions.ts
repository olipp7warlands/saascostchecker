"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendInvitationEmail } from "./email";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  loginSchema,
  signUpOrganizationSchema,
} from "./schemas";

export type ActionResult = { error: string } | { success: true };

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function signUpOrganization(input: unknown): Promise<ActionResult> {
  const parsed = signUpOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const { email, password, fullName, orgName, orgSlug, defaultCurrency, locale } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        org_name: orgName,
        org_slug: orgSlug,
        default_currency: defaultCurrency,
        locale,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect(`/${locale}`);
}

export async function signInWithPassword(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  redirect(`/${locale}`);
}

export async function signInWithGoogle(locale: string): Promise<never> {
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=/${locale}`,
    },
  });

  if (error || !data.url) {
    redirect(`/${locale}/login?error=oauth`);
  }

  redirect(data.url);
}

export async function createInvitation(
  orgName: string,
  locale: "es" | "en",
  input: unknown,
): Promise<ActionResult> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();

  const { error } = await supabase.rpc("create_invitation", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error) {
    return { error: error.message };
  }

  const origin = (await headers()).get("origin");
  await sendInvitationEmail({
    email: parsed.data.email,
    orgName,
    locale,
    inviteUrl: `${origin}/${locale}/invite/${rawToken}`,
  });

  return { success: true };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: invitationId,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function getInvitationPreview(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", {
    p_token_hash: hashToken(token),
  });

  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0] as { org_name: string; email: string; role: string };
}

export async function acceptInvitation(locale: string, input: unknown): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const tokenHash = hashToken(parsed.data.token);
  const preview = await getInvitationPreview(parsed.data.token);

  if (!preview) {
    return { error: "Invalid or expired invitation" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: preview.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        invitation_token_hash: tokenHash,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect(`/${locale}`);
}
