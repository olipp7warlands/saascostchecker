# TASKS — Roadmap por bloques

Regla: un bloque por sesión. No empezar un bloque si el anterior no pasa lint + typecheck + tests. Detalle completo de cada bloque en `SPECS.md` §7.

## FASE 0 — Fundaciones

### 0.1 Scaffolding
- [x] Next.js 15 + TS estricto + Tailwind 4 + shadcn/ui
- [x] Supabase local (`supabase init`, `supabase start`) — proyecto remoto enlazado queda pendiente (ver `docs/DECISIONS.md`)
- [x] next-intl configurado con `messages/es.json` y `messages/en.json`
- [x] Fuentes (Bricolage Grotesque, Instrument Sans, IBM Plex Mono) y tokens de diseño en Tailwind
- [x] CI en GitHub Actions: lint + typecheck + test en cada PR
- ✅ Aceptación: `pnpm dev` levanta una página con los tokens aplicados en ambos idiomas

### 0.2 Multi-tenancy y Auth
- [x] Migración: `organizations`, `users`, trigger de perfil al registrarse
- [x] Signup de organización (nombre, moneda default, locale) + login email (Google OAuth implementado pero aplazado a 4.2, ver docs/DECISIONS.md)
- [x] Invitaciones por email con rol preasignado (token de un solo uso)
- [x] Políticas RLS por `org_id` + helper `current_org_id()`
- [x] Tests de aislamiento: usuario de org A no puede leer/escribir datos de org B (obligatorio)
- ✅ Aceptación: dos orgs de prueba con datos invisibles entre sí, verificado por test automatizado

### 0.3 Usuarios y departamentos
- [x] Migración: `departments` (con `manager_user_id`)
- [x] CRUD de departamentos y gestión de usuarios/roles (solo org_admin)
- [x] Asignación de departamento a cada usuario
- ✅ Aceptación: matriz de permisos de SPECS §5 aplicada y testeada en server actions

### 0.4 Layout base
- [x] Shell: sidebar desktop + bottom nav móvil (como mockups.html)
- [x] Selector de idioma persistente, menú de usuario
- [x] Navegación visible según rol
- ✅ Aceptación: shell responsive idéntico en estructura al mockup, AA en foco de teclado

## FASE 1 — Visibilidad manual

### 1.1 Catálogo global
- [x] Migración: `saas_catalog` (global, sin org_id) + seed de ~500 SaaS con aliases y categorías
- [x] Componente `<AppLogo domain/>` (favicon + fallback a inicial con color derivado)
- [x] Componente de autocompletado reutilizable (busca en nombre + aliases)
- ✅ Aceptación: escribir "figm" sugiere Figma con su logo en <150 ms
- [x] Ampliación (2026-07-15): +144 herramientas de IA en 7 categorías nuevas (`ai_assistant`, `ai_coding`, `ai_image_video`, `ai_audio_voice`, `ai_writing`, `ai_meeting_agents`, `ai_api_platform`), con alias de extracto bancario reales y fixture del matcher de 1.3 ampliado (200→220 filas, ≥70% se mantiene) — ver docs/DECISIONS.md

### 1.2 Vendors y contratos
- [x] Migraciones: `vendors`, `contracts` + Storage bucket para PDFs
- [x] CRUD vendors (desde catálogo o custom) y contratos (coste, ciclo, asientos, renewal_date, auto_renews, cancellation_notice_days)
- [x] Vista de listado con utilización, renovación y owner (mockup pantalla 2)
- ✅ Aceptación: crear vendor + contrato con PDF en <1 min; audit_log registra todo

### 1.3 Import de gasto (CSV)
- [x] Migraciones: `spend_records`, `reconciliation_queue`, `import_batches`
- [x] Importador CSV con mapeo de columnas configurable y preview
- [x] Deduplicación por hash (fecha+importe+descripción)
- [x] Fuzzy matcher `raw_description` → catálogo (aliases incluidos) con confidence score
- [x] Cola de reconciliación: vincular / crear vendor / ignorar
- ✅ Aceptación: CSV bancario de 200 filas importado y ≥70% auto-sugerido correctamente con el seed demo (100% medido en `src/features/spend-import/import-acceptance.test.ts`)

### 1.4 Licencias manuales
- [x] Migración: `seat_assignments`
- [x] Asignar/quitar asientos por contrato; marcado de inactivos
- [x] Métrica de utilización por contrato (usada en 1.5)
- ✅ Aceptación: contrato con 12/20 asientos muestra 60% y € desperdiciado estimado

### 1.5 Dashboard
- [x] KPIs: gasto anualizado, vendors, licencias sin uso, renovaciones a 90 días
- [x] Pista de renovaciones (componente firma, mockup pantalla 1) con scroll horizontal en móvil
- [x] Gasto por departamento (sin "vs. presupuesto" — ver docs/DECISIONS.md, candidata a fase futura); widget de cola de reconciliación
- ✅ Aceptación: paridad visual con el mockup; datos reales del seed demo (verificado con dataset conocido en `e2e/dashboard.spec.ts`)

## FASE 2 — Renovaciones y alertas

### 2.1 Motor de alertas
- [ ] Cron diario (Vercel Cron) que evalúa `renewal_date` y `cancellation_notice_days`
- [ ] Alertas 90/60/30/7 días → tabla `notifications`; idempotente (no duplica)
- ✅ Aceptación: test con fechas simuladas genera exactamente las alertas esperadas

### 2.2 Canales
- [ ] Email vía Resend con plantillas bilingües
- [ ] Teams Incoming Webhook por org (URL en settings, mensaje con tarjeta adaptativa)
- ✅ Aceptación: alerta de prueba llega a email y Teams con deep-link al contrato

### 2.3 Calendario de renovaciones
- [ ] Vista lista/calendario (mockup pantalla 3), snooze, estados renegociado/cancelado
- [ ] Registro de ahorro conseguido por renegociación
- ✅ Aceptación: KPI "ahorro conseguido" agrega los cierres del año

## FASE 3 — Procurement

### 3.1 Solicitudes
- [ ] Migración: `purchase_requests`
- [ ] Formulario self-service con autocompletado del catálogo y timeline de estados
- ✅ Aceptación: empleado crea y consulta sus solicitudes; nunca las de otros (RLS test)

### 3.2 Motor de aprobaciones (SPECS §6 completo)
- [ ] Migraciones: `approval_rules`, `approval_actions`, `approval_delegations`
- [ ] Materialización de pasos (snapshot), precedencia depto > global, conversión de moneda antes de evaluar
- [ ] Links firmados (JWT un solo uso, 7 días) para aprobar desde email/Teams sin login
- [ ] Auto-skip si solicitante = aprobador; recordatorio 72h; escalado 7 días; delegaciones
- [ ] Seed de matriz default para orgs nuevas
- [ ] Tests de TODOS los edge cases listados en SPECS §6
- ✅ Aceptación: los 4 edge cases pasan en CI; aprobar desde link firmado funciona

### 3.3 Cierre del ciclo
- [ ] Conversión solicitud aprobada → vendor + contrato precargado (1 clic)
- [ ] Historial de negociación y notas por vendor
- ✅ Aceptación: flujo completo solicitud→aprobación→contrato en e2e de Playwright

### 3.4 Catálogo interno
- [ ] Al solicitar, detectar solapamiento con stack existente ("ya tienes Jira") con coste y renovación
- ✅ Aceptación: solicitud de herramienta ya contratada muestra el aviso con ahorro neto (mockup pantalla 4)

## FASE 4 — Comercialización
### 4.1 Billing (Stripe: subscripción por empleados, planes y límites)
### 4.2 Onboarding self-service (wizard: departamentos → CSV → equipo → matriz)
- [ ] Reactivar login con Google (OAuth) — código ya implementado desde el bloque 0.2, oculto tras el feature flag `NEXT_PUBLIC_FEATURE_GOOGLE_OAUTH` (ver docs/DECISIONS.md)
- [ ] Wizard: departamentos → CSV → invitar equipo → configurar matriz de aprobación
### 4.3 Hardening (rate limiting, export de datos, marketing site)

## FASE 5 — Integraciones API (al final)
### 5.1 Discovery IdP (Google Workspace, Microsoft Entra → `discovered_apps` → cola de reconciliación de 1.3)
### 5.2 Sync de licencias vía SSO (`last_seen_active_at`, inactivos 30/60/90)
### 5.3 APIs de gasto (ERP/contabilidad, agregadores bancarios)
