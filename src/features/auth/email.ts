import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Plantillas bilingües completas llegan en el bloque 2.2 (motor de notificaciones).
// Aquí basta un email transaccional mínimo para que la invitación sea usable.
export async function sendInvitationEmail(params: {
  email: string;
  orgName: string;
  inviteUrl: string;
  locale: "es" | "en";
}) {
  const { email, orgName, inviteUrl, locale } = params;
  const subject =
    locale === "es"
      ? `Te han invitado a ${orgName} en StackX`
      : `You've been invited to ${orgName} on StackX`;
  const body =
    locale === "es"
      ? `Únete a ${orgName} en StackX: ${inviteUrl}\n\nEste enlace caduca en 7 días.`
      : `Join ${orgName} on StackX: ${inviteUrl}\n\nThis link expires in 7 days.`;

  if (!resend) {
    // Sin RESEND_API_KEY configurada (dev local): loguea el enlace en vez de fallar.
    console.info(`[invitation-email] ${email}: ${inviteUrl}`);
    return;
  }

  await resend.emails.send({
    from: "StackX <onboarding@resend.dev>",
    to: email,
    subject,
    text: body,
  });
}
