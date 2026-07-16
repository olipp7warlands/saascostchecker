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
- [ ] Pendiente: commit + push a `main` + verificación de producción con `curl`.
