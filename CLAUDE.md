# Stackly — Instrucciones para Claude Code

Plataforma multi-tenant de gestión de SaaS (visibilidad de gasto, renovaciones, procurement). Los documentos fuente de verdad son:

- `docs/SPECS.md` — especificaciones completas: modelo de datos, roles, motor de aprobaciones (§6), fases y bloques
- `docs/TASKS.md` — roadmap por bloques con criterios de aceptación; trabaja SIEMPRE un bloque a la vez y marca los checkboxes al terminar
- `docs/mockups.html` — referencia visual de las 4 pantallas clave (ábrelo en navegador); replica su sistema de diseño

## Stack (no cambiar sin consultar)
- Next.js 15 (App Router, Server Components por defecto) + TypeScript estricto
- Supabase: Postgres, Auth, RLS, Storage, Edge Functions. Cliente vía `@supabase/ssr`
- Tailwind CSS 4 + shadcn/ui
- next-intl para i18n (es/en)
- Resend para email. Vercel Cron para jobs programados
- Tests: Vitest (unit) + Playwright (e2e críticos)

## Reglas de arquitectura (innegociables)
1. **Multi-tenancy**: TODA tabla de datos lleva `org_id` con política RLS. Excepción única: `saas_catalog` (global). Cada migración que cree una tabla debe incluir sus políticas RLS en el mismo archivo. Nunca confiar en filtros de aplicación para aislamiento.
2. **Migraciones**: SQL en `supabase/migrations/`, nunca cambios manuales en la DB. Nombres: `NNNN_descripcion.sql`.
3. **i18n**: cero strings visibles hardcodeadas. Todo en `messages/es.json` y `messages/en.json`. Añadir ambas claves siempre.
4. **Moneda**: almacenar `amount numeric + currency char(3)`. Los agregados se convierten a la moneda default de la org. Cifras siempre con fuente mono y `tabular-nums` (clase `.num`).
5. **Permisos**: roles `employee | manager | finance | it_admin | org_admin` (jerarquía en SPECS §5). Comprobar permisos en servidor (RLS + server actions), la UI solo oculta.
6. **Auditoría**: toda mutación de negocio (contratos, aprobaciones, reglas) escribe en `audit_log`.
7. **Nada de APIs de terceros** (Google/Microsoft/Okta/bancos) hasta la Fase 5. Todo entra por CSV o formularios.

## Sistema de diseño (de docs/mockups.html)
- Tokens: fondo `#F5F6F2`, superficie `#FFF`, tinta `#1B2733`, primario `#0E5F59`, ámbar `#E8A13C` (SOLO para urgencia/renovaciones), rojo `#C4452F`, línea `#E3E6DF`
- Tipos: Bricolage Grotesque (titulares), Instrument Sans (UI), IBM Plex Mono (toda cifra)
- Móvil: sidebar → bottom nav; tablas con scroll horizontal; acciones a ancho completo
- Componente firma: la "pista de renovaciones" del dashboard (tickets posicionados por días restantes)

## Convenciones de código
- Server Actions para mutaciones; rutas API solo para webhooks/links firmados
- Componentes en `src/components/`, features en `src/features/<dominio>/`
- Zod para validación en toda entrada de usuario y todo CSV
- Commits: conventional commits (`feat:`, `fix:`, `chore:`) en inglés
- Al terminar un bloque: `pnpm lint && pnpm typecheck && pnpm test` deben pasar

## Flujo de trabajo
1. Lee el bloque actual en `docs/TASKS.md` y su sección en `docs/SPECS.md`
2. Propón un plan corto de implementación ANTES de escribir código
3. Implementa, con tests de las reglas críticas (aislamiento RLS, motor de aprobaciones, matcher de reconciliación)
4. Marca los checkboxes del bloque y anota decisiones tomadas en `docs/DECISIONS.md`
