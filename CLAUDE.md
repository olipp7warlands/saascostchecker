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

## Entorno de desarrollo
- **Esta máquina de desarrollo NO tiene Docker ni Supabase local, y no se instalan.** El entorno de desarrollo es exclusivamente el proyecto **remoto** de Supabase (`mkrsicuvhnmljpurtwun`). `.env.local` apunta a `https://mkrsicuvhnmljpurtwun.supabase.co` — así es como se ejecutan `pnpm dev` y `pnpm build`.
- Las migraciones se escriben en `supabase/migrations/` y se aplican al remoto con `supabase db push` (el proyecto ya está enlazado). `supabase db reset`/`supabase start` (local) no se ejecutan nunca en esta máquina.
- Deploy: Railway, automático con cada push a `main`.
- Los tests de aislamiento/permisos (`rls-isolation.test.ts`, `permissions.test.ts`) y cualquier e2e que cree tenants reales (p.ej. `e2e/dashboard.spec.ts`) SÍ necesitan Supabase local — pero **ese Supabase local solo existe dentro de los runners de GitHub Actions** (`.github/workflows/ci.yml` ya lo levanta con `supabase/setup-cli` + `supabase start -x ...`), nunca en esta máquina. `.env.test.local` (gitignored) existe para que, SI algún día se corre en un entorno con Docker, Vitest lo cargue en vez de `.env.local` — pero el flujo normal de trabajo aquí es: no levantar Docker, dejar que esos tests concretos se verifiquen empujando a una rama y revisando el run de CI (`gh run watch` / `gh run view`), no ejecutándolos en local.
- **No intentes arrancar Docker Desktop ni `supabase start` en esta máquina** aunque un test lo requiera — si `pnpm test` local falla solo en `rls-isolation.test.ts`/`permissions.test.ts`/e2e con tenants reales, es esperado: confirma que el resto de la suite pasa, y verifica esos tests concretos vía CI.
- Google OAuth queda aplazado al bloque 4.2 (Onboarding self-service) — el botón está oculto tras un feature flag (`NEXT_PUBLIC_FEATURE_GOOGLE_OAUTH`) hasta entonces.

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
- Al terminar un bloque: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` deben pasar (el build de producción es parte del gate — un módulo `"use server"` roto no lo detectan lint/typecheck/test)

## Flujo de trabajo
1. Lee el bloque actual en `docs/TASKS.md` y su sección en `docs/SPECS.md`
2. Propón un plan corto de implementación ANTES de escribir código
3. Implementa, con tests de las reglas críticas (aislamiento RLS, motor de aprobaciones, matcher de reconciliación)
4. Marca los checkboxes del bloque y anota decisiones tomadas en `docs/DECISIONS.md`
