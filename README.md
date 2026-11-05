# Simulador Mates 3D — SaaS MVP

Simulador 3D para talleres de grabado láser: configuran el mate, lo comparten con su
cliente por enlace y cierran la venta. Implementación del paquete de especificaciones
`../simulador_Mates/` (9 specs + guía de stack + orden de construcción).

**Estado**: ✅ Posición 2 de 10 — *Perfil + `resolveBranding()`* implementada y commiteada
(`3cf09d0`, 20 archivos). ⚠️ Pendiente operativo: **correr `supabase/migrations/0002_profile_fields.sql`
en el SQL Editor** — hasta entonces `/perfil` falla en el proyecto real ("column does not exist").
Mapa completo y evidencia: `PROYECTO.md`.

---

## Stack (posiciones 1–2)

| Capa | Hoy |
| :--- | :--- |
| Framework | Next.js **15.5** (App Router) + React 19 + TypeScript strict |
| Estilos | Tailwind CSS v4 (CSS-first, `@theme inline`) |
| Backend | Supabase (Postgres + RLS + Auth + Realtime) vía `@supabase/ssr` |
| Estado/3D | Zustand + R3F/drei → se instalan en la posición 3 |
| Test unit | Vitest 4 (31 tests: matriz R2 + branding en `tests/unit/`) |

> Pinning deliberado: `next@15.5` (línea estable) por compatibilidad oficial con
> `@supabase/ssr` y React 19; Next 16 puede migrar por su cuenta más adelante.
>
> ⚠️ Known issue menor: `npm audit` reporta vulnerabilidades de `postcss ≤8.5.22` **arrastradas por
> Next 15.5** (build-time; no llegan a runtime con CSS propio). El fix de fuerza bruta salta a
> `next@16` (breaking) — se revisa al llegar a la posición 8 o cuando estabilice Next 16.

## Estructura (guia_de_tecnologias §7)

```text
simulador-mates/
  app/
    auth/            → Auth Overlay + callback OAuth (PKCE) + banner neutro de cuenta baja (R8)
    perfil/          → PANEL DE PERFIL (posición 2): 5 campos + indicador 5×20 % + zona de peligro
    (editor)/editor/ → shell del editor con gating R2 (guard deleted_at; escena 3D: posiciones 3–7)
    api/
      config/pricing/ → GET pricing (patrón: backend como única fuente del precio)
      profile/logo/   → POST/DELETE del logo (server revalida por magia de bytes)
      profile/delete/ → POST eliminar cuenta (soft + hard delete + signOut)
      auth/exit/      → GET signOut server + redirect con mensaje neutro
    setup/            → página amable si faltan env vars
  components/        → auth / profile / editor / paywall / session / ui
  lib/
    permissions.ts   → MATRIZ R2 (única fuente, alineada a spec_auth §3-R2)
    branding.ts      → resolveBranding() + approvalCode() (fallbacks canónicos R3/R5)
    profile.ts       → completitud 5×20 % + copy dinámico
    encode-logo.ts   → pipeline del logo en CLIENTE (webp ≤512 + thumb 144)
    supabase/        → client / server / service (+ Storage branding) / middleware
  supabase/
    migrations/  → esquema: 0001_auth_skeleton.sql · 0002_profile_fields.sql (idempotentes, sin DROP)
    ops/         → reparaciones re-ejecutables: 0901 backfill · 0910 grants · 0920 purga R8
  tests/         → Vitest (unit); Playwright en la posición 8
  three/         → vacío hasta la posición 3 (ver three/README.md)
```

## Setup desde cero

1. **Paquetes**: `npm install` (Node ≥ 20; probado con Node 24 / npm 12).
2. **Supabase** → crear proyecto en [supabase.com] con región **sa-east-1** (latencia regional, §6 de la guía).
3. **Migraciones** (SQL Editor, en orden — ambas idempotentes, sin DROP):
   1. `supabase/migrations/0001_auth_skeleton.sql` — users/projects/pricing + trigger + RLS.
   2. `supabase/migrations/0002_profile_fields.sql` — columnas de perfil (brand_name, logo_url,
      logo_thumb_url, whatsapp_e164, instagram_handle, location, deleted_at) + CHECKs.
      > El bucket de Storage `branding` **no se crea a mano**: la app lo crea sola en la primera
      > subida de logo (service role). Es **privado**: en la base solo quedan PATHS; las vistas
      > usan URLs firmadas de 1 h.
4. **Dashboard (Auth)**
   - Providers → **Google**: activarlo (Client ID/Secret de Google Cloud) + Redirect URLs:
     `http://localhost:3000/auth/callback`.
   - **Confirm email: OFF** — es la regla "fricción cero" (R1 spec usuario); la verificación
     real ocurre solo al pagar (R7, token 24 h — posición 8–10).
   - Database → Replication → activar **public.users** (desbloqueo realtime sin reload, R6 spec_auth).
5. **Env**: `cp .env.local.example .env.local` y completar las 3 variables.
   (un archivo llamado `.env` también vale — Next lo carga igual; `.env.local` únicamente gana
   si existieran ambos)
6. **Dev**: `npm run dev` → `http://localhost:3000/auth`.

> ⚠️ Windows/PowerShell: si `npm` da *Execution Policy* error, usar `npm.cmd` (es el shim ps1
> bloqueado, no el npm real).

## Si algo falla (los síntomas que este setup ya vivió)

| Síntoma | Motivo | Arreglo |
| :--- | :--- | :--- |
| En vez del login se ve la página `/setup` | falta una env var, o el server arrancó antes de crearse `.env` | completar las variables y **reiniciar** `npm run dev` (las envs se leen solo al boot) |
| `/perfil` rompe con `column users.whatsapp_e164 does not exist` (u otra de las nuevas) | la posición 2 quedó en el código **antes** de correr `0002` en el proyecto | correr `supabase/migrations/0002_profile_fields.sql` (idempotente) |
| `STORAGE_INDISPONIBLE` al subir el logo | falta `SUPABASE_SERVICE_ROLE_KEY` en `.env`: sin ella no se puede crear el bucket privado | completar la env y **reiniciar** el server |
| `permission denied for table pricing_config` (la top bar no muestra precio) | el proyecto no aplica los GRANT automáticos de Supabase | correr `supabase/ops/0910_base_grants.sql` |
| Cartel "No existe fila en public.users" | cuenta registrada ANTES de ejecutar la migración (el trigger no va hacia atrás) | correr `supabase/ops/0901_backfill_user_rows.sql` |
| Re-registrar un email ya borrado falla ("No pudimos crear la cuenta") | Confirm email ON ⇒ cada registro dispara un email ⇒ se agota el cupo por hora | Confirm email = **OFF** (regla R1: fricción cero) y reintentar |
| Cuenta eliminada no puede volver a entrar | así debe ser (R8): `deleted_at` bloquea el login con mensaje neutro por diseño | restaurar manualmente con `supabase/ops/0920_purge_deleted_accounts.sql` (solo ≤30 días, solicitada por el mismo email) |

Extra: el editor logea en la terminal el error crudo de su SELECT (`[editor] public.users read
error ...`) — si algo sigue fallando, esa es la línea exacta a mirar.

## ¿Qué quedó de la posición 1? (según `spec_autenticacion_...` §7)

| QA | Estado |
| :--- | :--- |
| Visitante ⇒ redirect inmediato al Auth Overlay | ✅ middleware (`lib/supabase/middleware.ts`) |
| Login (Google/email) aterriza en el editor | ✅ `/auth` → `/editor` |
| Reabrir <30 días no pide re-login (refresh rotativo) | ✅ cookies + refresh en cada request |
| Cerrar sesión limpia local sin borrar proyectos | ✅ signOut (RLS preserva filas) |
| Registro 2 campos + nombre derivado (`kevin.firma` ⇒ *"Kevin Firma"*) | ✅ trigger DB `handle_new_user` |
| Matriz R2 declarada como única fuente citable | ✅ `lib/permissions.ts` + test unit |
| Gating de UI (🔒 decorativo; Paywall en cada intento) | ✅ `TopBar`/`EditorShell` |
| Precio dinámico desde `pricing_config` (backend) | ✅ `GET /api/config/pricing` (200 verificado en runtime) |
| `402` de export, watermark, links, MP | 🔜 posiciones 8–10 |

**Smoke test del trigger**: `select public.derive_base_name('kevin.firma@correo.com');` → `Kevin Firma`.

## ¿Qué quedó de la posición 2? (según `spec_..._datos_de_usuario_y_registro.md`)

| Requisito | Estado |
| :--- | :--- |
| Panel `/perfil`: 5 campos de branding con guardado inline + indicador 5×20 % | ✅ |
| Logo: encode en cliente (webp ≤512 px + thumb 144), server revalida por bytes, original jamás persistido | ✅ |
| Bucket privado `branding` con PATHS en DB + URL firmada 1 h (creación lazy) | ✅ |
| Fallbacks únicos: `resolveBranding()` (título/iniciales/fila oculta) + código `APROBADA-{VARIANTE}-{LINKID}` | ✅ (consumo en ficha/visor: pos 6–10) |
| Ubicación jamás impresa en outputs (R2 del módulo) | ✅ (test: el resuelto no la contiene) |
| `email_verified` derivado de auth (`email_confirmed_at`, sin columna) | ✅ |
| Eliminar cuenta: doble confirmación en pantalla + soft/hard delete + bloqueo neutro + `ops/0920` (30 días) | ✅ (link por email: pos 8–10) |
| Aviso "links desactualizados" (R6) + gate de compra con email verificado (R7) | 🔜 pos 8–10 |

**Smoke gating** (server efímero, sin sesión): `/perfil` 307→`/auth` · logo/delete 401 ·
`/api/auth/exit` 307→`/auth?cuenta=inhabilitada` · `/auth?cuenta=eliminada` 200.

**Pendiente de tu prueba manual** — correr `0002_profile_fields.sql` y luego: subir un logo
(observá el indicador % y la vista previa), guardar los 5 campos con sesión real y eliminar la
cuenta de prueba para ver el bloqueo neutro del re-login.

## Scripts

```bash
npm run dev         # editor + API
npm run build       # build de producción (typecheck incluido)
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (matriz R2 + branding, 31 tests)
```

## Roadmap (fuente: `../simulador_Mates/orden_de_implementacion.md`)

1. ✅ **Esqueleto Auth** — probada de punta a punta en el proyecto real de Supabase (04-nov)
2. ✅ **Perfil + `resolveBranding()`** — commiteada (`3cf09d0`); pendiente correr `0002` en el proyecto real
3. ⬜ Catálogo de mates + `projects.state` — `spec_tipo_de_mate` ← siguiente
4. ⬜ Medidas/guías + cascada — `spec_tecnica_geometrica...`
5. ⬜ Color PBR + quemado adaptativo — `spec_seleccion_de_color`
6. ⬜ Rotación del diseño — `spec_rotacion_...`
7. ⬜ Escala + alerta de chorreo — `spec_escala_y_alerta_...`
8. ⬜ Protección (watermark, 402) — auth paso B
9. ⬜ Ficha técnica export — `spec_detalle_del_modelo_en_ficha`
10. ⬜ Links comerciales + pagos MP — links + `spec_pagos`

Cada bloque de trabajo se abre leyendo la spec fuente: los números (latencias,
límites, constantes) solo se cambian allí y de ahí se re-verifican los consumidores.
