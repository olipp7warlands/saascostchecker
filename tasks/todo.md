# Rebrand Stackly → StackX — todo

Plan: `C:\Users\olcas\.claude\plans\inherited-strolling-quiche.md`

## Checklist
- [x] globals.css tokens (bg/surface/ink/line/lime/success/warning/danger/primary/ring/radius-btn/radius-input)
- [x] layout.tsx fonts (Inter replaces Bricolage+Instrument)
- [x] shared Wordmark component + call sites (sidebar, home-nav, home-footer, mobile-header — found during verification, not in original plan list)
- [x] radius swaps: button.tsx, pill.tsx, cta-link.tsx, input.tsx, select.tsx, saas-combobox.tsx, local input-class constants, + 2 "add" CTA links in vendors/import pages (found during verification)
- [x] status-color migration: pill.tsx, renewal-track.tsx, kpi-cards.tsx, utilization-bar.tsx+seats.ts+seats.test.ts, reconciliation-preview.tsx, stat-card.tsx, renewal-demo.tsx, stray text-red-600, contract-seats.tsx warning hex (found during verification)
- [x] wordmark/lime judgment calls: kicker labels, inline links, locale-switcher active chip + focus ring, user-menu focus ring, cta-link hover, how-it-works.tsx teal chip, features-grid.tsx icon chip + home-hero.tsx eyebrow bg (found during verification)
- [x] naming: messages/es.json + en.json, layout.tsx metadata, email.ts, docs/SPECS.md, CLAUDE.md, docs/DECISIONS.md, delete landing.html, docs/mockups.html historical comment
- [x] verification: lint/typecheck/build pass; test passes except the pre-existing local-Supabase-required suites (expected, see CLAUDE.md); Playwright screenshots of landing (desktop+mobile) and login/signup forms confirm tokens/wordmark/radii/CTA render correctly. Dashboard/vendors/contract-form screenshots BLOCKED — remote Supabase project requires email confirmation to sign up, and hit its email-send rate limit after 2 attempts. Code for those screens was reviewed directly (renewal-track tone classes, kpi-cards, radius) rather than screenshotted.
- [ ] Follow-up: get authenticated screenshots (dashboard renewals track, vendors table, contract form) once an email-confirmed test account is available, or ask user for existing test credentials.
- [x] Pushed to main (e5cae1f) and verified production: /es, /en, /es/login, /es/signup all 200, and response HTML confirms new build ("StackX" title, `text-lime` wordmark) is live — took ~4 poll cycles (~1min) for Railway to roll out.

# Rediseño UI post-rebrand — corrección + patrón "ficha" — todo

Plan: `C:\Users\olcas\.claude\plans\gentle-wobbling-boot.md`

## Checklist
- [x] Fase A: bug de fuentes — `--font-sans` en `<body>` pero consumido en `<html>` (custom properties heredan hacia abajo, no hacia arriba); fix: mover las clases de variable de next/font a `<html>` en `layout.tsx`
- [x] Fase B1: sidebar/bottom-nav/mobile-header claros (`bg-surface`/`border-line`), nuevo token `--lime-soft`, `nav-link.tsx` a client component con `usePathname()` para estado activo real
- [x] Fase B2: jerarquía de botones — destructive de `bg-destructive/10` (pill rosa) a `border-destructive bg-background text-destructive`; link/terciario a subrayado permanente; documentado en CLAUDE.md
- [x] Fase B3: `ConfirmDialog` nuevo, migrados los 5 sitios de `window.confirm`/sin-confirmación (vendor, contrato, departamento, empresa, asiento)
- [x] Fase C: primitivos nuevos — `tabs.tsx`, `avatar.tsx`, `breadcrumbs.tsx`, `kebab-menu.tsx`, `primary-action.ts` (+ 5 tests)
- [x] Fase D: ficha de vendor con tabs (Detalles/Contratos/Asientos/Documentos/Notas), cabecera con botón primario contextual, rail de renovación+gasto
- [x] Fase E: `ContractFields`/`new-vendor-form` reorganizados en fieldsets con secciones + filas de 2 columnas
- [x] Fase F: tabla de vendors enriquecida — celda 2 líneas, estado punto+texto, owner con avatar, coste+ciclo, kebab de acciones
- [x] Fase G: breadcrumbs reales (vendors list + ficha) y saludo con nombre en el dashboard
- [x] Bug encontrado en verificación visual autenticada (no detectable por lint/typecheck/build): `nav-link.tsx` al convertirse a `"use client"` seguía recibiendo `item: NavItem` completo desde el Server Component padre, incluyendo `item.icon` (referencia a componente, no serializable) — "Only plain objects can be passed to Client Components" en runtime. Fix: `NavLink` pasa a recibir `icon: ReactNode` ya renderizado por el padre.
- [x] Inconsistencia encontrada en la misma verificación: el rail de renovación calculaba "crítico" con `renewalTone(daysUntil(...))` (solo fecha bruta) mientras la cabecera usaba la ventana accionable (con preaviso de cancelación) — un contrato marcado "Renegociar" no salía en rojo en el rail. Fix: `actionableDaysUntil` extraído a `renewal.ts`, reusado por ambos.
- [x] Verificación: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — todo en verde (los 6 suites que requieren Supabase local fallan como siempre, esperado). Verificación visual con Playwright: páginas públicas (landing/login/signup, sin auth) + sesión autenticada real (usuario+org+4 vendors+contratos sembrados vía service-role, con autorización explícita del usuario, y borrados por completo al terminar — verificado con query que confirma 0 filas huérfanas) cubriendo dashboard, tabla de vendors, ficha en los 3 estados de `pickPrimaryAction` (crítico/normal/sin contrato), formulario en modo edición y pestaña Contratos, desktop+móvil.
- [x] `docs/DECISIONS.md` y `CLAUDE.md` actualizados con los 2 bugs reales, el patrón "primario contextual", los 2 deferrals de scope (historial de notas, renegociación real — ambos bloque 3.2/3.3), y el procedimiento estándar de verificación autenticada contra remoto.
- [x] Commit `2460ace` pusheado a `main`. Producción verificada tras el rollout de Railway (~1.5 min, 5 polls): `/es`, `/en`, `/es/login`, `/es/signup` todos 200, y el HTML de respuesta confirma el fix real desplegado — las clases de variable de next/font aparecen en `<html>` (antes en `<body>`).

# Mini-bloque: gráficas del dashboard — todo

Plan: `C:\Users\olcas\.claude\plans\elegant-gliding-kite.md`

## Checklist
- [x] Umbrales de renovación (`CRITICAL_THRESHOLD_DAYS`/`WARNING_THRESHOLD_DAYS`) extraídos a `renewal.ts`, reusados por `renewalTone`/`primary-action.ts`/el donut nuevo
- [x] Donut "Estado del stack" (`stack-status-donut.tsx`): agrupa por vendor activo vía `buildStackStatus`, 4 buckets (crítico/próximo/estable/sin contrato activo), leyenda con link a `/vendors` en el último bucket
- [x] Evolución de gasto (`monthly-spend-chart.tsx`): migración `0014_dashboard_monthly_spend.sql` (agregación SQL por mes+moneda), `buildMonthlySpendSeries` rellena huecos a 0, chart de área/línea con hover+crosshair, estado vacío con link a `/import`
- [x] Gasto por departamento/empresa (`spend-by-group-chart.tsx`): `DepartmentSpendTable.tsx` reemplazada por chart de barras real con toggle Departamento/Empresa (`Tabs` existente), `buildCompanySpend` nueva, mayor barra en lima resto en `--barfill` (token nuevo)
- [x] Accesibilidad: SVG/barras `aria-hidden`, tabla `sr-only` junto al chart de barras (mismo texto que la tabla que sustituye — `e2e/dashboard.spec.ts` sigue pasando sin tocarlo)
- [x] Tests: `buildStackStatus`/`buildCompanySpend` en `aggregate.test.ts`, `monthly-spend.test.ts` nuevo; `renewal.test.ts`/`primary-action.test.ts` verificados sin cambios tras la extracción de constantes
- [x] `docs/DECISIONS.md` actualizado con la elección de SVG propio, semántica del donut, criterio "reconciliado", patrón de accesibilidad
- [x] Verificación: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde (mismos suites de Supabase local fallando como siempre); `supabase db push` de la migración 0014 al remoto confirmado
- [x] Verificación visual autenticada (usuario+org+vendors en los 4 estados del donut+contratos con departamento y empresa+spend_records en 5 meses con un hueco, sembrados vía service-role con autorización explícita del usuario, borrados por completo al terminar — 0 filas huérfanas confirmado): encontrados y corregidos 2 bugs reales solo visibles en captura — (1) el área del chart de evolución era opaca y tapaba 3 de las 4 etiquetas del eje Y (fix: wash semitransparente al 12% + labels repintadas por encima); (2) el título de "Gasto por departamento" no cambiaba a "Gasto por empresa" al activar el toggle (fix: título condicional al tab activo). Estado vacío, estado con datos, desktop y móvil, y el toggle Departamento/Empresa capturados.
- [x] Commit `999ccbd` + fix de seguimiento `90808df` (toggle ilegible + barras del chart) pusheados a `main`. Producción verificada con `curl`: `/`, `/es`, `/en`, `/es/login`, `/es/signup` → 307/200.

# Bloque 2.1 — Motor de alertas de renovación — todo

## Checklist
- [x] Cron diario `pg_cron` (`evaluate_renewal_alerts()`, `supabase/migrations/0015_renewal_alerts.sql`), decisión documentada en `docs/DECISIONS.md` (evita la causa raíz del incidente de producción del 2026-07-15)
- [x] Alertas 90/60/30/7 días + preaviso vencido en tabla `notifications`, idempotente por unique index
- [x] Destinatarios: owner del vendor + finance de la org
- [x] Panel campanita in-app (`notification-bell.tsx`) en sidebar + mobile header
- [x] Tests con fechas simuladas + idempotencia (`renewal-alerts.test.ts`) — requiere Supabase local, se verifica en CI
- [x] `docs/TASKS.md` bloque 2.1 marcado completo, `docs/DECISIONS.md` actualizado
- [x] Commit `5f45db3` pusheado a `main`. Producción verificada con `curl` en esta sesión: `/es`, `/en`, `/es/login`, `/es/signup` → 200.

# Bloque 2.2 — Canales (email + Teams) — todo

Plan: `C:\Users\olcas\.claude\plans\toasty-gathering-stallman.md`

## Checklist
- [x] Migración `0016_notification_channels.sql`: tabla `org_notification_settings` (RLS org_admin-only, más estricta que `organizations`), RPCs `upsert_org_notification_settings`/`get_org_notification_settings` con validación anti-SSRF del webhook (https + host anclado a `.webhook.office.com`/`.logic.azure.com`), `pg_net`, función `trigger_send_pending_notifications()` + segundo `pg_cron` cada 15 min — pusheada al remoto (`supabase db push`)
- [x] `src/lib/supabase/service-role.ts` + `src/features/renewals/send-notifications.ts` (plantillas bilingües HTML/Adaptive Card, deep-link, envío Resend/Teams)
- [x] `src/app/api/cron/send-notifications/route.ts` — secreto comparado con `crypto.timingSafeEqual`, semántica de fallo parcial por canal, try/catch por fila
- [x] Fix `vendor-ficha.tsx`: lee `#contract-{id}` del hash al montar y activa la pestaña Contratos (afecta también al deep-link ya existente del dashboard)
- [x] Feature `notification-settings` (schemas con anti-SSRF duplicado + i18n, actions: get/save/sendTestAlert con deep-link real y fallback sintético) + UI `settings/notifications` + entrada de nav
- [x] i18n `Settings.notifications.*` + `Shell.nav.notificationSettings` en es/en
- [x] Tests unitarios: `send-notifications.test.ts` (plantillas, deep-link, escape HTML) + `notification-settings/schemas.test.ts` (anti-SSRF, incluido el caso trampa `evil.com/webhook.office.com`)
- [x] `.env.local.example` con `CRON_SECRET`/`NEXT_PUBLIC_SITE_URL` nuevos
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde (mismos suites de Supabase local fallando como siempre)
- [x] Verificación en vivo contra el proyecto remoto (usuario+org de prueba sembrados vía service-role con autorización explícita del usuario, borrados al terminar — 0 filas huérfanas confirmado): defaults correctos sin fila, RPC rechaza el dominio SSRF-trampa, acepta un dominio válido, persiste, y escribe exactamente 1 fila de `audit_log`
- [x] `docs/TASKS.md` §2.2 marcado, `docs/DECISIONS.md` con la entrada completa (trigger desacoplado, GUCs, las 2 decisiones de seguridad, semántica de fallo parcial, fix del hash/tab, formato de tarjeta de Teams)
- [x] GUC descartado (`permission denied to set parameter` en el remoto gestionado) → migración `0017_notification_secrets_vault.sql`: `trigger_send_pending_notifications()` reescrita para leer `site_url`/`cron_secret` de Supabase Vault (`vault.decrypted_secrets`), mismo comportamiento defensivo (raise warning + no-op si faltan). Verificación de que `anon`/`authenticated` no pueden leer `vault.decrypted_secrets`/`vault.secrets` embebida en la propia migración (bloque `do $$`), confirmada en el push real de esta sesión. `0016` actualizada apuntando a `0017`. `docs/DECISIONS.md` con la entrada completa. `supabase db push` aplicado al remoto. Gate completo en verde (lint/typecheck/build; test con el mismo patrón de fallos esperados de Supabase local).
- [ ] **Pendiente — 2 pasos manuales que solo puede hacer el usuario, fuera del alcance de esta máquina/sesión:**
  1. Railway: añadir env vars `CRON_SECRET` (secreto generado en sesión previa, pedir al usuario si se perdió) y `NEXT_PUBLIC_SITE_URL=https://saascostchecker-production.up.railway.app` — la segunda es `NEXT_PUBLIC_*`, debe estar presente en tiempo de BUILD, no solo runtime. Confirmar también si `RESEND_API_KEY` ya está puesta en Railway (bloque 2.1 no lo confirmó) — sin ella, el envío de email cae al fallback de `console.info`, no llega email real.
  2. SQL editor del proyecto remoto de Supabase: crear los 2 secretos en Vault con `vault.create_secret(...)` — SQL exacto en `docs/DECISIONS.md` (sección "GUC de Postgres descartado, sustituido por Supabase Vault"). Sin esto, el cron de envío corre cada 15 min sin efecto (no-op vía `raise warning`, no rompe nada, pero no envía nada tampoco).
- [ ] Pendiente: una vez completados los 2 pasos anteriores, probar de extremo a extremo con el botón "Enviar alerta de prueba" de la página de ajustes contra un email y un webhook de Teams reales.
- [x] Commit `6a00277` (migración 0017 + docs) pusheado a `main`. Producción verificada con `curl`: `/es/login`, `/es`, `/en`, `/es/signup` → 200.
