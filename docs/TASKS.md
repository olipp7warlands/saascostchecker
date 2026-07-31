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
- [x] Ampliación (2026-07-16): `/team/departments` gana entrada real en el nav de Ajustes (antes solo accesible por URL directa, ver docs/DECISIONS.md)

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
- [x] Ampliación (2026-07-16): soporte multi-empresa — tabla `companies` (dimensión independiente de `departments`, ver docs/DECISIONS.md) + `contracts.company_id`; selector de Empresa con creación inline (mini-modal, org_admin) junto al de Departamento en el formulario de vendor+contrato; CRUD propio en Ajustes → Empresas; `<select>`/input de archivo del formulario de contrato migrados a componentes del design system (`Select`/`Input type=file`)

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
- [x] Cron diario (`pg_cron` en Supabase remoto, no Vercel/Railway — ver docs/DECISIONS.md) que evalúa `renewal_date` y `cancellation_notice_days`
- [x] Alertas 90/60/30/7 días + aviso de preaviso vencido → tabla `notifications`; idempotente por unique index (no duplica)
- [x] Destinatarios: owner del vendor + usuarios `finance` de la org (solo finance si no hay owner)
- [x] Panel mínimo in-app: campanita en el shell con contador de no leídas + lista, marcar leída/marcar todo
- ✅ Aceptación: test con fechas simuladas (91/90/89/60/30/7/6 días + preaviso vencido) genera exactamente las alertas esperadas — `src/features/renewals/renewal-alerts.test.ts`, incluye test explícito de idempotencia (ejecutar dos veces el mismo día no duplica)

### 2.2 Canales
- [x] Email vía Resend con plantillas bilingües
- [x] Teams Incoming Webhook por org (URL en settings, mensaje con tarjeta adaptativa)
- ✅ Aceptación: alerta de prueba llega a email y Teams con deep-link al contrato — verificado con datos reales: secretos de Vault y env vars de Railway creados, pasada real del cron con 200 en logs de Railway, alerta de prueba entregada a email y Teams con deep-link aterrizando en la pestaña Contratos (ver docs/DECISIONS.md)

### 2.3 Calendario de renovaciones
- [x] Vista calendario (mockup pantalla 3, alcance acotado con el usuario — ver `docs/DECISIONS.md`)
- [x] Snooze, estados renegociado/cancelado (bloque 2.3b — ver `docs/DECISIONS.md`)
- [x] Registro de ahorro conseguido por renegociación (`savings_records`, bloque 2.3b)
- ✅ Aceptación: KPI "ahorro conseguido" agrega los cierres del año — completo y verificado

## Bloque adicional — Tags por vendor + Presupuestos por bolsa

Fuera de la numeración de fases (ni SPECS.md ni este roadmap lo cubrían). Cierra la deuda dejada explícitamente en 1.5 ("vs. presupuesto" quedó fuera por falta de un concepto de presupuesto en el modelo — ver docs/DECISIONS.md). Diseño propuesto y aprobado por el usuario antes de implementar.

- [x] Migración: `budgets` (bolsa departamento × empresa × año fiscal, con precedencia por especificidad al resolver), `vendor_tags`, `vendors.annual_cap`
- [x] Cálculo de consumo/proyección/semáforo (`src/features/budgets/aggregate.ts`, `thresholds.ts`) — reutiliza el mismo dataset de `spend_records` reconciliados que `dashboard_monthly_spend()`, sin RPC nueva de agregación
- [x] Tags: alta/baja desde la ficha del vendor con autocompletado, filtro por tag en `/vendors`
- [x] UI de presupuestos en `/team/budgets` (lectura MANAGER_ROLES, escritura finance/org_admin), resumen discreto en el dashboard
- ✅ Aceptación: tests unitarios del cálculo de consumo/proyección/semáforo (año parcial, sin presupuesto, reparto multi-departamento, conversión de moneda, overrun) en verde; RLS/permisos y e2e de tags y presupuestos verificados en CI

## FASE 3 — Procurement

### 3.1 Solicitudes
- [x] Migración: `purchase_requests`
- [x] Formulario self-service con autocompletado del catálogo y timeline de estados
- ✅ Aceptación: empleado crea y consulta sus solicitudes; nunca las de otros (RLS test) — verificado en `src/features/requests/permissions.test.ts` y replicado contra el remoto (ver docs/DECISIONS.md)

### 3.1b Ciclo de aprobación (single-level)
Interino entre 3.1 y el motor completo de 3.2 (ver docs/DECISIONS.md) — un
único nivel de aprobación (finance + org_admin, sin matriz por depto/monto),
pedido explícitamente por el usuario antes de construir el motor completo de
SPECS §6.
- [x] Migración: estado `cancelled`, columna `rejection_reason`, RLS de lectura ampliada a finance/org_admin
- [x] RPCs: `resolve_purchase_request` (approve/reject), `cancel_purchase_request` (solo solicitante), `mark_purchase_request_purchased` (botón manual, sin automatismo de conversión)
- [x] Notificaciones reutilizando 2.1/2.2: `purchase_request_submitted` (a aprobadores), `purchase_request_resolved` (al solicitante) — nueva columna `request_id` + índice de idempotencia propio
- [x] Enlace "Crear vendor/contrato" precargado desde una solicitud aprobada (`/vendors/new` con prefill vía query params)
- ✅ Aceptación: tests de la máquina de estados y permisos por rol en CI; RLS ampliada verificada; idempotencia de notificaciones verificada; e2e solicitar→aprobar→notificar y solicitar→rechazar con motivo

### 3.2a Motor de aprobaciones — núcleo end-to-end
Primera pasada del motor completo de SPECS §6 (ver docs/DECISIONS.md) — deja
**fuera** de esta pasada, explícitamente diferido a 3.2b: RPCs de edición de
`approval_rules` (org_admin no puede editar la matriz todavía, solo existe el
seed default) y `approval_delegations`.
- [x] Migraciones: `approval_rules` (seed default por org, sin RPC de edición), `purchase_request_steps` (snapshot materializado), `approval_actions`, `approval_link_tokens`
- [x] Materialización de pasos (snapshot inmutable), precedencia depto > global, conversión de moneda antes de evaluar (`convert_amount()`, puerto SQL de la versión TS)
- [x] Links firmados de un solo uso (72h, no JWT — token aleatorio + hash SHA-256, mismo patrón que las invitaciones; ver docs/DECISIONS.md) para aprobar/rechazar desde email/Teams sin login, revocados si la solicitud cambia de estado por otra vía
- [x] Auto-skip si solicitante = aprobador, con tope de seguridad (nunca auto-aprueba sin una decisión humana distinta del solicitante — reasigna a otro rol); recordatorio 72h; escalado 7 días (idempotentes, doble pasada verificada)
- [x] Seed de matriz default para orgs nuevas (vía `handle_new_user()`) + backfill de orgs existentes
- [x] Fallback de departamento sin manager → escalado a org_admin, con `resolved_via` explicado en la UI + aviso visible en `/team/departments`
- ✅ Aceptación (3.2a): materialización por tier + auto-skip con tope + fallback sin manager + inmutabilidad del snapshot + ciclo completo del link + idempotencia de recordatorio/escalado, todos con test dedicado en `src/features/requests/approval-engine.test.ts` + `e2e/requests-approval.spec.ts`; delegaciones y edición de reglas quedan para 3.2b

### 3.2b Delegaciones + UI de administración de approval_rules
- [x] `approval_delegations` (rango de fechas, aditivo, sin cadenas, autoservicio + `org_admin`) + `/settings/delegations` (propias + "cubriendo a" + vista `org_admin` de todas)
- [x] Resolución dinámica del aprobador efectivo (`resolve_effective_approver()`), nunca congelada en el snapshot — recordatorio/escalado y notificaciones la consideran sin duplicar destinatario
- [x] Actor real + delegante en `approval_actions`/timeline ("Decidido por X en nombre de Y"), incluida la atribución vía link firmado (`approval_link_tokens.token_actor_id`/`token_delegated_from_id`)
- [x] Anti-auto-aprobación también vía delegado; edge case del delegado=solicitante (notifica al original, no al delegado)
- [x] `save_approval_rule_scope()` (reemplazo atómico por scope — desviación deliberada de los 3 RPCs originalmente previstos, ver docs/DECISIONS.md) + `restore_default_approval_rules()` + `/team/approval-rules` (matriz global + overrides por departamento, validación de solapes/huecos/bordes en Zod y en la RPC)
- ✅ Aceptación (3.2b): tests dedicados en `src/features/delegations/delegations.test.ts` + `src/features/approval-rules/approval-rules.test.ts` (vigente/expirada/revocada, anti-auto-aprobación, sin cadena, actor+delegante, validación de tramos, inmutabilidad bajo edición en vuelo) + `e2e/requests-approval.spec.ts` (delegar→aprobar→timeline "en nombre de")
- **Bloque 3.2 (a+b) cerrado por completo.**

### 3.3 Cierre del ciclo
- [x] Conversión solicitud aprobada → vendor + contrato precargado (1 clic)
- [ ] Historial de negociación y notas por vendor (fuera de alcance de esta sesión — no pedido explícitamente; el vendor ya tiene pestaña "Notas" y renegociación con `savings_records` desde bloques anteriores, pendiente de revisar si eso ya lo cubre o falta algo específico)
- ✅ Aceptación: flujo completo solicitud→aprobación→contrato en e2e de Playwright (`e2e/requests-approval.spec.ts`, describe "Cierre del ciclo: conversión a vendor/contrato") + guarda anti-doble-conversión y camino de vendor existente con tests dedicados en `src/features/requests/conversion.test.ts`

### 3.4 Catálogo interno
- [x] Al solicitar, detectar solapamiento con stack existente ("ya tienes Jira") con coste y renovación
- ✅ Aceptación: solicitud de herramienta ya contratada muestra el aviso con ahorro neto (mockup pantalla 4) — verificado en `src/features/requests/catalog-overlap.test.ts` + `e2e/requests-approval.spec.ts` (describe "Catálogo interno") + verificación visual autenticada contra el remoto, ver docs/DECISIONS.md
- **Bloque 3.4 cerrado. FASE 3 — Procurement (3.1–3.4) completa.**

## Bloque adicional (futuro) — Vista de gestión de procurement

Fuera de la numeración de fases (no está en SPECS.md — no confundir con §3.4
"Catálogo interno" de arriba, que es una feature distinta). Pedido por el
usuario el 2026-07-31 bajo el nombre "bloque 3.4"; al auditar se detectó que
no coincide con el §3.4 real, así que se deja anotado aquí como trabajo
futuro separado en vez de construirse en esa sesión (ver docs/DECISIONS.md).

- [ ] Página `/requests/manage` para MANAGER_ROLES: tabla de todas las
      solicitudes de la org con filtros (estado, departamento, empresa, rango
      de importe), orden por antigüedad del paso activo
- [ ] Métricas de cabecera: pendientes ahora / atascadas >72h (misma
      semántica que el recordatorio existente) / tiempo medio de decisión
      últimos 90 días / % auto-aprobadas — reutilizando helpers existentes,
      sin recalcular por vía paralela
- [ ] Fila enlaza al detalle; las convertidas (3.3) muestran su vínculo al contrato
- [ ] **Pendiente de decidir antes de construir**: `purchase_requests_select`
      (post 3.2b) da visibilidad org-wide solo a `finance`/`org_admin` +
      solicitante + aprobadores/delegados de paso — **no incluye `it_admin`**,
      así que no cubre el patrón `MANAGER_ROLES` estándar del resto del repo.
      Requiere decidir la ampliación mínima de RLS antes de implementar esta
      vista.

## FASE 4 — Comercialización
### 4.1 Billing (Stripe: subscripción por empleados, planes y límites)
### 4.2 Onboarding self-service (wizard: departamentos → CSV → equipo → matriz)
- [ ] Reactivar login con Google (OAuth) — código ya implementado desde el bloque 0.2, oculto tras el feature flag `NEXT_PUBLIC_FEATURE_GOOGLE_OAUTH` (ver docs/DECISIONS.md)
- [ ] Wizard: departamentos → CSV → invitar equipo → configurar matriz de aprobación
### 4.3 Hardening (rate limiting, export de datos, marketing site)
- [x] Tarea extra (adelantada, 2026-07-16): home pública real sustituyendo el placeholder de 0.1, fidelidad exacta a `landing.html` (hero + pista de renovaciones demo animada, sección IA, cómo funciona, funciones, CTA final, footer)
- [x] Redirect a `/dashboard` si hay sesión activa; CTAs a `/signup`/`/login`; anclas de la nav funcionales
- [x] Bilingüe (es/en), cero strings hardcodeadas; SEO básico (title/description por locale, og tags)
- ✅ Aceptación: e2e verifica carga en ambos idiomas, navegación de CTAs/anclas, y redirect con sesión activa — ver docs/DECISIONS.md

## FASE 5 — Integraciones API (al final)
### 5.1 Discovery IdP (Google Workspace, Microsoft Entra → `discovered_apps` → cola de reconciliación de 1.3)
### 5.2 Sync de licencias vía SSO (`last_seen_active_at`, inactivos 30/60/90)
### 5.3 APIs de gasto (ERP/contabilidad, agregadores bancarios)

## FASE 6 — Fases futuras (sin fase asignada, no comprometido)

Backlog sin planificar todavía. Cada entrada tiene ya un hueco reservado (gris, solo visible para `org_admin`) al final del nav — ver `src/components/shell/nav-items.ts` — para que el usuario sepa que están en el radar sin prometer fecha. Orden de prioridad: Software propio > Marketplace > Inventario.

### 6.1 Software propio (inventario de herramientas internas, vibe-coded / no-code)
Visión: inventario de herramientas internas construidas con IA/vibe-coding — owner, departamento y qué SaaS podría sustituir cada una (insumo futuro del motor de ahorros).
- [ ] `vendors.source` (`'saas' | 'internal'`) — herramientas construidas in-house (vibe-coded, low-code/no-code) en vez de contratadas a un tercero
- [ ] Campos específicos de `source = 'internal'`: owner técnico, repo/URL, hosting, APIs externas que consume (vinculables a los `spend_records` existentes de esos proveedores — p.ej. una herramienta interna que gasta en OpenAI/Vercel/Supabase aparece con su propio gasto de API), criticidad, estado de riesgo
- [ ] Estado de riesgo: **huérfana** si el owner técnico deja la organización (sin owner técnico asignado tras la baja); reutiliza el motor de alertas de 2.1 (cron diario, tabla `notifications`, mismo patrón de idempotencia) en vez de construir uno nuevo
- ✅ Aceptación (borrador, a refinar cuando se planifique el bloque): una herramienta interna sin owner técnico tras la baja de su responsable se marca huérfana y genera una alerta; el gasto de API que consume aparece correlacionado en su ficha

### 6.2 Marketplace
Visión: listado de ofertas de herramientas vía acuerdos con partners. **Nota legal**: el origen de datos serán partners o fuentes licenciadas/APIs públicas — scraping de webs de pricing queda descartado por riesgo legal (el producto está pensado para venderse y debe pasar due diligence).

### 6.3 Inventario (activos hardware)
Visión: activos hardware del grupo (equipos, monitores...), su ciclo de vida y asignación a personas/departamentos. Última prioridad de las tres.
