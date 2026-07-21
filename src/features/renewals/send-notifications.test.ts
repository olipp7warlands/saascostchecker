import { describe, expect, it } from "vitest";
import {
  buildContractDeepLink,
  buildContractPath,
  buildTeamsAdaptiveCard,
  escapeHtml,
  renderRenewalAlertEmail,
  type RenewalAlertPayload,
} from "./send-notifications";

const NORMAL_PAYLOAD: RenewalAlertPayload = {
  vendor_name: "Acme SaaS",
  contract_name: "Licencias Acme",
  renewal_date: "2026-09-01",
  days_until: 30,
};

const NOTICE_EXPIRED_PAYLOAD: RenewalAlertPayload = {
  vendor_name: "Acme SaaS",
  contract_name: "Licencias Acme",
  renewal_date: "2026-09-01",
  notice_days: 60,
  notice_expired: true,
};

describe("escapeHtml", () => {
  it("escapa < > & \" ' para evitar inyección de HTML desde datos de negocio", () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe(
      "&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;",
    );
  });
});

describe("buildContractPath", () => {
  it("devuelve el path relativo con el ancla #contract-{id}, sin origen", () => {
    expect(buildContractPath("es", "vendor-1", "contract-1")).toBe(
      "/es/vendors/vendor-1#contract-contract-1",
    );
  });
});

describe("buildContractDeepLink", () => {
  it("construye la URL con el ancla #contract-{id} sobre la ficha de vendor", () => {
    const link = buildContractDeepLink("es", "vendor-1", "contract-1");
    expect(link).toContain("/es/vendors/vendor-1#contract-contract-1");
  });

  it("respeta el locale en la ruta", () => {
    const link = buildContractDeepLink("en", "vendor-1", "contract-1");
    expect(link).toContain("/en/vendors/vendor-1");
  });
});

describe("renderRenewalAlertEmail", () => {
  it.each(["es", "en"] as const)("payload normal, locale %s: incluye vendor, contrato y CTA", (locale) => {
    const deepLink = buildContractDeepLink(locale, "vendor-1", "contract-1");
    const { subject, html } = renderRenewalAlertEmail(NORMAL_PAYLOAD, locale, deepLink);

    expect(subject).toContain("Licencias Acme");
    expect(subject).toContain("30");
    expect(html).toContain("Acme SaaS");
    expect(html).toContain("Licencias Acme");
    expect(html).toContain(deepLink);
  });

  it.each(["es", "en"] as const)("preaviso vencido, locale %s: incluye notice_days, no days_until", (locale) => {
    const deepLink = buildContractDeepLink(locale, "vendor-1", "contract-1");
    const { subject, html } = renderRenewalAlertEmail(NOTICE_EXPIRED_PAYLOAD, locale, deepLink);

    expect(subject).toContain("Licencias Acme");
    expect(html).toContain("60");
    expect(html).toContain(deepLink);
  });

  it("escapa nombres de vendor/contrato con caracteres HTML antes de interpolar", () => {
    const malicious: RenewalAlertPayload = {
      vendor_name: "<script>evil</script>",
      contract_name: "Normal",
      renewal_date: "2026-09-01",
      days_until: 10,
    };
    const { html } = renderRenewalAlertEmail(malicious, "es", "https://example.test");
    expect(html).not.toContain("<script>evil</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildTeamsAdaptiveCard", () => {
  it.each(["es", "en"] as const)("payload normal, locale %s: tarjeta adaptativa con acción OpenUrl al deep-link", (locale) => {
    const deepLink = buildContractDeepLink(locale, "vendor-1", "contract-1");
    const card = buildTeamsAdaptiveCard(NORMAL_PAYLOAD, locale, deepLink) as {
      attachments: { content: { actions: { url: string }[]; body: { text: string }[] } }[];
    };

    const content = card.attachments[0].content;
    expect(content.actions[0].url).toBe(deepLink);
    expect(JSON.stringify(content.body)).toContain("Acme SaaS");
    expect(JSON.stringify(content.body)).toContain("Licencias Acme");
  });

  it.each(["es", "en"] as const)("preaviso vencido, locale %s: menciona notice_days", (locale) => {
    const deepLink = buildContractDeepLink(locale, "vendor-1", "contract-1");
    const card = buildTeamsAdaptiveCard(NOTICE_EXPIRED_PAYLOAD, locale, deepLink) as {
      attachments: { content: { body: { text: string }[] } }[];
    };

    expect(JSON.stringify(card.attachments[0].content.body)).toContain("60");
  });
});
