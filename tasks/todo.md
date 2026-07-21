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
- [x] Pasos manuales completados por el usuario: env vars `CRON_SECRET`/`NEXT_PUBLIC_SITE_URL` en Railway, secretos `site_url`/`cron_secret` creados en Supabase Vault.
- [x] Verificación de extremo a extremo completa: `curl` a `/api/cron/send-notifications` → 200 con secreto correcto / 401 sin él; pasada real del cron (`send-pending-notifications`) visible en logs de Railway con 200; alerta de prueba entregada a un email y un webhook de Teams reales, deep-link aterrizando en la pestaña Contratos; `service_role` key rotada tras la verificación, con smoke test posterior. Detalle completo en `docs/DECISIONS.md` ("Cierre — pasos manuales completados por el usuario").
- [x] Commit `6a00277` (migración 0017 + docs) pusheado a `main`. Producción verificada con `curl`: `/es/login`, `/es`, `/en`, `/es/signup` → 200.
- [x] Commit `1d4c9db` (cierre administrativo docs/TASKS.md + docs/DECISIONS.md) pusheado a `main`.
- [x] **Bloque 2.2 CERRADO por completo** — checkbox de aceptación en `docs/TASKS.md` §2.2 actualizado, sin pendientes.

# Bloque 2.3 (subconjunto: vista calendario) — Calendario de renovaciones — todo

## Estado: implementado, pendiente verificación visual autenticada + deploy

Alcance pedido por el usuario para esta pasada de 2.3 (nota: es un subconjunto del 2.3 completo de
`docs/TASKS.md` — la vista calendario en sí. Snooze, marcar renegociado/cancelado y el registro de
ahorro conseguido que también lista `docs/TASKS.md` §2.3 NO están en el alcance pedido; no marcar el
checkbox de aceptación de 2.3 en `docs/TASKS.md` como completo hasta que esas piezas también existan
o se decida explícitamente diferirlas a un bloque 2.3b).

### Resumen del diseño propuesto (mensaje completo al usuario, no repetido aquí en detalle)
- Nueva ruta `src/app/[locale]/(app)/renewals/page.tsx`; entrada de nav: el placeholder `"renewals"`
  ya existente en `src/components/shell/nav-items.ts` (roles `["finance","it_admin","org_admin"]`,
  idénticos a `vendors`) solo necesita `href: null` → `href: "/renewals"`, sin tocar roles.
- Dos marcadores por contrato reusando `renewal.ts` (`CRITICAL_THRESHOLD_DAYS=7`,
  `WARNING_THRESHOLD_DAYS=45`, `renewalTone`, `actionableDaysUntil`) sin recalcular umbrales:
  marcador primario con color de urgencia en la fecha accionable real (`renewalDate -
  cancellationNoticeDays` si `autoRenews`, si no `renewalDate`), y marcador secundario mudo/informativo
  en `renewalDate` solo si difiere de la fecha accionable. Ambos son `<a>` reales al patrón relativo de
  `renewal-track.tsx` (`/{locale}/vendors/{vendorId}#contract-{contractId}`), NO `buildContractDeepLink`
  (esa es para links absolutos de email/Teams).
- Sin librería de calendario nueva — CSS grid/tabla propia, mismo criterio que `renewal-track.tsx`/
  `monthly-spend-chart.tsx`.
- Filtros: 2 selects de único valor (empresa/departamento, reusan `Select` como en
  `company-field.tsx`/`department-field.tsx`, sin precedente de multi-select en el repo) +
  checkbox "ocultar sin auto-renovación" (patrón de `notification-settings-form.tsx`, no existe
  `Switch`). Todo estado local (`useState`), sin params de URL — mismo patrón que
  `spend-by-group-chart.tsx`.
- Navegación de mes + botón "Hoy", estado local, `Intl.DateTimeFormat` para el label del mes y las
  cabeceras de día de semana (sin claves i18n para eso — ya está localizado).
- i18n: namespace nuevo `"Renewals"` a nivel raíz en `messages/es.json`/`en.json` (paralelo a
  `Vendors`/`Settings`, no anidado bajo `Shell`).
- Tests: unit `src/features/renewals/calendar.test.ts` (mapeo contratos→días, fin de mes, cambio de
  año, `autoRenews=false`, `cancellationNoticeDays=0`, contratos `cancelled` excluidos) + e2e
  `e2e/renewals.spec.ts` (mismo patrón RPC-seed + login real que `dashboard.spec.ts`).

### 3 puntos de decisión explícitos pendientes de respuesta del usuario
1. **Extraer query compartida de contratos**: la query anidada vendor→contracts→departments/companies
   vive inline en `dashboard/page.tsx` (~40 líneas). Propuesto extraerla a un helper compartido (p.ej.
   `src/features/dashboard/fetch-contracts.ts`) reusado por `dashboard/page.tsx` y la nueva
   `renewals/page.tsx`, en vez de duplicarla — toca `dashboard/page.tsx` (fuera del scope estricto de
   2.3, de ahí la pregunta explícita). Alternativa si el usuario prefiere no tocar `dashboard/page.tsx`:
   duplicar la query en la página nueva.
2. **Accesibilidad — desviación deliberada del patrón de los charts**: los charts existentes
   (donut/barras/línea) son decorativos y usan `aria-hidden` + tabla `sr-only` separada. Aquí los chips
   SON el contenido interactivo real (los deep-links), así que ocultarlos con `aria-hidden` rompería el
   acceso por teclado/lector de pantalla al único elemento que importa. Propuesto: tabla `<table>`
   semántica real con `<a>` reales dentro (mismo criterio que `renewal-track.tsx`, que tampoco usa
   `aria-hidden`), más una lista de agenda `sr-only` adicional como alternativa lineal a la rejilla 2D.
   Pendiente de confirmación explícita porque el usuario pidió "accesibilidad como en los charts" y esto
   es intencionalmente distinto (con justificación).
3. (Menores, no bloqueantes salvo que el usuario redirija): semana siempre en lunes independientemente
   del locale; celdas con >3 eventos muestran 3 chips + texto "+N más" sin popover.

### 3 puntos de decisión — confirmados por el usuario (2026-07-21), los 3 tal como se propusieron
1. Extraer query compartida → sí, `fetchDashboardContracts()`.
2. Accesibilidad con tabla semántica + agenda `sr-only` → sí, tal cual.
3. Lunes fijo + "+N más" sin popover → sí, tal cual.

Un cambio adicional pedido por el usuario al aprobar el plan: nada de construir el deep-link a mano en
ningún sitio nuevo — extraer `buildContractPath()` de `buildContractDeepLink()` en `send-notifications.ts`
y migrar también `renewal-track.tsx` (que hoy también lo construía a mano) al mismo helper. Implementado
(ver checklist abajo) — detalle completo, incluido el efecto colateral de bundling con Resend que forzó
además extraer `getResendClient()`, en `docs/DECISIONS.md` (2026-07-21).

## Checklist (implementación)
- [x] `buildContractPath()` extraído en `send-notifications.ts` (`buildContractDeepLink` reusa),
  `renewal-track.tsx` migrado al mismo helper; `getResendClient()` lazy (ya no a nivel de módulo) para
  que el archivo sea seguro de importar desde un Client Component; test nuevo de `buildContractPath` en
  `send-notifications.test.ts`
- [x] `TONE_CLASSES`/`TONE_TEXT_CLASSES` extraídas a `src/features/vendors/renewal-tone-classes.ts`
  (antes locales a `renewal-track.tsx`, que importa `next-intl/server` — server-only, no bundleable en
  el calendario cliente)
- [x] `fetchDashboardContracts()` en `src/features/dashboard/fetch-contracts.ts`, `dashboard/page.tsx`
  actualizado para usarla (comportamiento idéntico)
- [x] `src/features/renewals/calendar.ts` (`buildCalendarMonth`) + `calendar.test.ts` (9 tests: marcador
  primario/secundario, `autoRenews=false`, `cancellationNoticeDays=0`, cancelados excluidos, rejilla de
  42 días, lunes fijo, diciembre→enero, año bisiesto)
- [x] `src/app/[locale]/(app)/renewals/page.tsx` (rol server-side, mismos roles que el nav item) +
  `renewals-calendar.tsx` (Client Component: navegación de mes, filtros empresa/departamento/
  auto-renovación, rejilla `<table>` semántica + agenda `sr-only`)
- [x] Nav: `nav-items.ts` `renewals.href` → `/renewals`
- [x] i18n: namespace `Renewals` nuevo en `es.json`/`en.json`
- [x] `e2e/renewals.spec.ts` (mismo patrón RPC-seed + login real que `dashboard.spec.ts`; fechas siempre
  en "el mes siguiente al actual" para que la navegación sea determinista sin importar qué día corra la
  suite)
- [x] `docs/TASKS.md` §2.3: vista calendario marcada, snooze/renegociado/ahorro explícitamente pendientes
  (checkbox de aceptación NO marcado)
- [x] `docs/DECISIONS.md` actualizado (entrada 2026-07-21)
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde (mismos 7 suites de Supabase
  local fallando como siempre, esperado); `pnpm build` confirma que `/renewals` compila a un tamaño de
  bundle normal (sin arrastrar el SDK de Resend)
- [x] Verificación visual autenticada contra el remoto: usuario+org+9 vendors/contratos sembrados vía
  service-role (`auth.admin.createUser` con `email_confirm:true`, evita el bloqueo de confirmación por
  email de sesiones anteriores) con autorización explícita del usuario, cubriendo los 6 casos que pidió
  explícitamente:
  1. Día 15 de julio con 4 contratos → "3 chips + 1 más" confirmado.
  2. `VendorNotice` (autoRenews + preaviso 15d) → 2 marcadores confirmados: accionable coloreado día 14,
     informativo mudo día 24.
  3. `VendorPadding` (accionable 5 ago) → visible en la última fila del grid de julio, `isCurrentMonth`
     false (número de día atenuado, fondo distinto).
  4. Los 3 tonos confirmados con colores correctos: `VendorRed` (crítico, rojo), `VendorAmber` (próximo,
     ámbar), `VendorStable` (estable, neutro — visible navegando a octubre 2026).
  5. Estado vacío confirmado navegando a septiembre 2026 ("No hay renovaciones este mes").
  6. Filtro de empresa (Acme Holding → solo `VendorRed`+`VendorNotice`), filtro de departamento
     (Ingeniería → `VendorA1`+`VendorAmber`+`VendorNotice`) y toggle "ocultar sin auto-renovación"
     (combinado con el filtro de departamento, deja solo `VendorNotice`, el único `autoRenews=true` del
     grupo) — los 3 confirmados funcionando y combinables.
  7. Clic en el chip de `VendorRed` navega a `/es/vendors/{id}#contract-{id}` y aterriza con la pestaña
     Contratos activa y el contrato correcto visible — deep-link real confirmado, incluido el
     `buildContractPath` compartido de §1b.
  - Viewport móvil: NO capturado — la herramienta de resize de ventana del navegador no tomó efecto en
    esta sesión (`window.innerWidth` no cambió tras varios intentos), reportado tal cual en vez de
    simular la captura. El grid ya envuelve la tabla en `overflow-x-auto` (mismo patrón que la tabla de
    vendors), pero queda sin confirmación visual — pendiente si se retoma con un navegador que sí permita
    redimensionar.
  - Bug pre-existente encontrado y descartado como fuera de alcance: error de hidratación de React
    (`id`/`aria-controls` de `notification-bell.tsx`, un componente base-ui) — confirmado que aparece
    igual en `/dashboard` sin ningún cambio de esta sesión, así que no lo introduje; no se toca aquí.
  - Limpieza verificada: script de borrado por `org_id` (vendors/contracts/companies/departments/users/
    organizations + `auth.admin.deleteUser`) con recuento posterior a 0 en las 6 tablas.
- [x] Commit `b2796fa` pusheado a `main`. Producción verificada tras el rollout de Railway (~6 polls):
  `/es`, `/en`, `/es/login`, `/es/signup` → 200; `/es/renewals` y `/es/dashboard` → 307 (mismo
  comportamiento de redirección a login para no autenticados, confirma que la ruta está viva y no da 500).
