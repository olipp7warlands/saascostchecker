# Specs — Plataforma de Gestión de SaaS (working name: "Stackly")

## 1. Visión
Plataforma multi-tenant de gestión de software (tipo Sastrify) que da visibilidad del stack de SaaS, gestiona renovaciones y contratos, y orquesta solicitudes de compra con aprobaciones. Uso interno primero (empresa de 25-100 empleados), comercialización después. **Estrategia: todo manual/CSV primero; integraciones API con terceros en la fase final.**

## 2. Decisiones de producto (entrevista)
| Decisión | Valor |
|---|---|
| Modelo | Multi-tenant desde el día 1 |
| Stack | Next.js (App Router) + Supabase (Postgres, Auth, RLS, Edge Functions, Storage) |
| Identidad de empleados | Entorno híbrido (Google + Microsoft + Okta) → conectores en FASE FINAL; antes, gestión manual |
| Fuentes de gasto | Import CSV (banco/tarjeta, export contable) + registro manual; APIs de ERP en fase final |
| Usuarios | Toda la empresa (self-service de solicitudes) |
| Aprobaciones | Matriz por departamento + monto (motor detallado en §6) |
| Notificaciones | Email (Resend) + Microsoft Teams (Incoming Webhooks) |
| Idiomas | ES/EN desde v1 (next-intl, cero strings hardcodeadas) |

## 3. Listado de softwares: enfoque de 3 capas (sin APIs)
1. **Catálogo global precargado** (`saas_catalog`): seed con ~500-1.000 SaaS comunes (nombre, aliases, logo, categoría, website). Autocompletado en todos los formularios.
2. **Alta manual libre**: vendors fuera del catálogo se crean como `custom`; promovibles al catálogo global (construye dataset propio, futuro activo comercial).
3. **Reconciliación desde el gasto**: al importar CSV bancario, fuzzy match de `raw_description` contra nombre + aliases del catálogo → sugerencias "¿esto es Figma?". El inventario crece desde facturas reales.

Cuando lleguen los conectores IdP (fase final), el discovery alimenta la misma cola de reconciliación: la arquitectura no cambia.

## 4. Modelo de datos (Postgres / Supabase)
Todas las tablas llevan `org_id` (FK a `organizations`) con Row Level Security por tenant, salvo `saas_catalog` (global). Convención: UUID pk, `created_at`, `updated_at`.

- **organizations**: name, slug, default_currency, locale
- **users**: auth_id (Supabase Auth), org_id, email, full_name, department_id, role (`employee | manager | finance | it_admin | org_admin`)
- **departments**: name, manager_user_id
- **companies** (grupos con varias sociedades): name, tax_id (opcional), is_default (bool, como mucho una por org). Dimensión INDEPENDIENTE de `departments`: empresa = quién paga, departamento = quién usa; los departamentos son transversales al grupo (un mismo departamento puede tener gasto en varias empresas)
- **saas_catalog** (global, sin org_id): name, aliases text[], category, website, logo_url, verified (bool)
- **vendors**: catalog_id (nullable), name, website, category, logo_url, status (`active | inactive | trial`), owner_user_id, is_custom (bool), notes
- **contracts**: vendor_id, name, cost_amount, currency, billing_cycle (`monthly | annual | one_time`), seats_purchased, start_date, renewal_date, auto_renews (bool), cancellation_notice_days, document_url (Storage), status, department_id (nullable, quién usa), company_id (nullable, quién paga — independiente de department_id)
- **licenses / seat_assignments**: contract_id, user_id, source (`manual | sso_sync`), last_seen_active_at (sso_sync se activa en fase final)
- **spend_records**: vendor_id (nullable hasta reconciliar), amount, currency, date, source (`card_csv | erp_csv | manual`), raw_description, import_batch_id
- **reconciliation_queue**: spend_record_id o discovered_app_id, suggested_catalog_id, confidence, status (`pending | linked | ignored`)
- **purchase_requests**: requester_id, vendor_name/catalog_id, estimated_annual_cost, currency, department_id, justification, alternatives_considered, status (`draft | pending | approved | rejected | purchased`), current_step
- **approval_rules**: department_id (nullable = global), min_amount, max_amount, approver_type (`manager_of_requester | finance | org_admin | specific_user`), approver_user_id (nullable), step_order
- **approval_actions**: request_id, step_order, approver_id, decision (`approved | rejected`), comment, decided_at
- **approval_delegations**: user_id, delegate_user_id, start_date, end_date
- **notifications**: user_id, type, payload jsonb, channels (`email | teams`), sent_at
- **discovered_apps** (fase final): source (`google | entra | okta`), first_seen, user_count, matched_vendor_id
- **integration_connections** (fase final): provider, credentials (Supabase Vault), status, last_sync_at
- **audit_log**: actor_id, action, entity, entity_id, diff jsonb, ip

## 5. Roles y permisos
- **employee**: crear/ver sus solicitudes, ver catálogo interno de apps aprobadas
- **manager**: + aprobar solicitudes de su departamento (según matriz)
- **finance**: + ver todo el gasto, importar spend, aprobar por monto
- **it_admin**: + gestionar vendors, contratos, licencias, reconciliación
- **org_admin**: + usuarios, departamentos, reglas de aprobación, settings, integraciones

## 6. Motor de aprobaciones (spec detallado)

### Reglas
Cada regla: `department_id` (null = global), rango `min_amount`–`max_amount` sobre **coste anualizado convertido a la moneda default de la org**, `step_order`, y aprobador por rol o usuario concreto. Las reglas de departamento tienen precedencia sobre las globales.

Matriz ejemplo (seed por defecto para cada org nueva):
| Monto anual | Paso 1 | Paso 2 |
|---|---|---|
| < €500 | Auto-aprobado | — |
| €500–5.000 | Manager del depto | — |
| > €5.000 | Manager del depto | Finance |

### Flujo de ejecución
1. Empleado envía solicitud → el motor resuelve reglas aplicables y **materializa los pasos** (snapshot inmutable: cambios de reglas posteriores no afectan solicitudes en vuelo)
2. Estado `pending`, `current_step = 1` → notificación email + Teams al aprobador con **link firmado** (JWT de un solo uso, expira 7 días) para aprobar/rechazar sin login
3. Aprobación → siguiente paso o `approved`. Rechazo → `rejected` con comentario obligatorio. El solicitante es notificado en cada transición
4. Al aprobar: acción "Convertir en vendor + contrato" que precarga los datos

### Reglas de robustez
- Si el solicitante ES el aprobador del paso (ej. un manager solicita), el paso salta al siguiente nivel
- Recordatorio automático a las 72h sin respuesta; escalado a org_admin a los 7 días
- Delegación de aprobaciones por rango de fechas (`approval_delegations`)
- Todo movimiento registrado en `approval_actions` + `audit_log` (actor, timestamp, comentario, IP)

### Edge cases (cubrir con tests)
- Solicitud sin departamento → fallback a reglas globales
- Cambio de reglas con solicitudes en vuelo → se respetan pasos materializados
- Monto en moneda distinta → conversión antes de evaluar rangos
- Aprobador desactivado/eliminado → escalado automático a org_admin

## 7. Fases y bloques de tareas

### FASE 0 — Fundaciones (0.1–0.4)
- **0.1 Scaffolding**: Next.js + TypeScript + Tailwind + shadcn/ui, Supabase, next-intl (es/en), CI (lint + typecheck)
- **0.2 Multi-tenancy y Auth**: signup de organización, invitaciones por email, Supabase Auth, RLS por org_id en todas las tablas, tests de aislamiento entre tenants
- **0.3 Usuarios y departamentos**: CRUD departamentos, gestión de usuarios/roles, asignación de manager
- **0.4 Layout base**: shell (sidebar, topbar, selector de idioma), sistema de permisos en UI

### FASE 1 — Visibilidad manual (1.1–1.5)
- **1.1 Catálogo global**: tabla `saas_catalog` + script de seed (~500-1.000 SaaS con aliases y categorías) + componente de autocompletado reutilizable. **Logos**: no se almacenan; componente `<AppLogo domain={...}/>` que carga el favicon del dominio (servicio de favicons de Google, `sz=64`) con fallback a inicial + color derivado del nombre. El catálogo guarda solo `website`.
- **1.2 Vendors y contratos**: CRUD completo, alta desde catálogo o custom, upload de contrato PDF a Storage, campos de renovación y asientos
- **1.3 Import de gasto (CSV)**: importador con mapeo de columnas configurable, deduplicación por hash, fuzzy matcher contra catálogo, cola de reconciliación con sugerencias y confidence score
- **1.4 Licencias manuales**: asignación de asientos por contrato, marcado manual de asientos inactivos, métrica de utilización
- **1.5 Dashboard**: gasto anualizado total / por categoría / por departamento, top vendors, apps sin owner, próximas renovaciones, € en licencias desperdiciadas

### FASE 2 — Renovaciones y alertas (2.1–2.3)
- **2.1 Motor de alertas**: cron diario (Vercel Cron o Edge Function) que evalúa renewal_date y cancellation_notice_days; alertas 90/60/30/7 días al owner + finance
- **2.2 Canales**: email (Resend) + Teams (Incoming Webhook por org, configurable en settings); plantillas bilingües
- **2.3 Calendario de renovaciones**: vista calendario/lista, snooze, marcar renegociado/cancelado, registro de ahorro conseguido

### FASE 3 — Procurement (3.1–3.4)
- **3.1 Solicitudes**: formulario self-service (autocompletado del catálogo, coste estimado, justificación, alternativas), estados y timeline visual
- **3.2 Motor de aprobaciones**: implementar §6 completo, incluidos links firmados y edge cases con tests
- **3.3 Cierre del ciclo**: conversión solicitud aprobada → vendor + contrato; historial de negociación por vendor
- **3.4 Catálogo interno**: al solicitar, mostrar software ya existente en la org ("ya tenemos Notion") para evitar duplicados

### FASE 4 — Comercialización (4.1–4.3)
- **4.1 Billing**: Stripe (subscripción por nº de empleados), planes free/pro, límites por plan
- **4.2 Onboarding self-service**: wizard (crear departamentos, importar primer CSV, invitar equipo, configurar matriz de aprobación)
- **4.3 Hardening**: auditoría completa, rate limiting, export de datos, páginas de marketing

### FASE 5 — Integraciones API (5.1–5.3) — al final, la arquitectura ya las soporta
- **5.1 Discovery IdP**: conectores Google Workspace (Admin SDK: OAuth tokens de apps de terceros) y Microsoft Entra (Graph: enterprise apps); sync diario → `discovered_apps` → misma cola de reconciliación de 1.3. Okta después.
- **5.2 Sync de licencias**: cruce automático SSO vs asientos pagados (`last_seen_active_at`), detección de inactivos 30/60/90 días
- **5.3 APIs de gasto**: conexión directa a ERP/contabilidad y agregadores bancarios, sustituyendo el CSV

## 8. Requisitos no funcionales
- RLS obligatorio en toda tabla con org_id; tests de aislamiento
- Credenciales cifradas en Supabase Vault (Fase 5)
- i18n total; formatos de moneda/fecha por locale
- Monedas: amount + currency; conversión a moneda default para agregados (tipos de cambio actualizados semanalmente)
- Accesibilidad AA; seed script con datos demo

## 9. Criterios de éxito del MVP (fin de Fase 2)
- 100% de contratos registrados con fecha de renovación
- Import de un CSV bancario reconciliado en <15 min
- 0 renovaciones sorpresa (alerta ≥30 días antes)
- Autocompletado del catálogo resuelve ≥80% de las altas de vendor
