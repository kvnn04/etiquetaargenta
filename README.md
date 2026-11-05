# Simulador Mates 3D — SaaS MVP

Simulador 3D para talleres de grabado láser: configuran el mate, lo comparten con su
cliente por enlace y cierran la venta. Implementación del paquete de especificaciones
`../simulador_Mates/` (9 specs + guía de stack + orden de construcción).

**Estado**: ✅ Posición 4 de 10 — *Medidas de la virola + anatomía 3 mallas (corona superior plana) + guías coplanares + cascada + auto-giro* implementada.
75 tests pasando en Vitest, build de producción 100% verde y TypeScript strict 0 errores.
Mapa completo y evidencia: `PROYECTO.md`.

---

## Stack (posiciones 1–4)

| Capa | Hoy |
| :--- | :--- |
| Framework | Next.js **15.5** (App Router) + React 19 + TypeScript strict |
| Estilos | Tailwind CSS v4 (CSS-first, `@theme inline`) |
| Backend | Supabase (Postgres + RLS + Auth + Realtime) vía `@supabase/ssr` |
| Estado | Zustand 5 — store del editor (snapshot de `projects.state`) |
| 3D | three 0.187 + @react-three/fiber 9.8 + drei 10.7 (catálogo lathe + virola 3 mallas + guías coplanares + auto-giro) |
| Test unit | Vitest 4 (75 tests: matriz R2 + branding + catálogo + virola/guías pos 4 en `tests/unit/`) |

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
    (editor)/editor/ → shell del editor con gating R2 (guard deleted_at; escena 3D real desde la posición 3)
    api/
      config/pricing/ → GET pricing (patrón: backend como única fuente del precio)
      profile/logo/   → POST/DELETE del logo (server revalida por magia de bytes)
      profile/delete/ → POST eliminar cuenta (soft + hard delete + signOut)
      auth/exit/      → GET signOut server + redirect con mensaje neutro
    setup/            → página amable si faltan env vars
  components/        → auth / profile / editor / studio / paywall / session / ui
  lib/
    permissions.ts   → MATRIZ R2 (única fuente, alineada a spec_auth §3-R2)
    branding.ts      → resolveBranding() + approvalCode() (fallbacks canónicos R3/R5)
    catalog.ts       → REGISTRO CENTRAL DE PRODUCTOS R1 (+ validación §6 y fallback R8)
    store/editor.ts  → zustand: estado del editor = snapshot de projects.state
    projects/        → persistence (restore/upsert + borrador local) · use-autosave (2 s + backoff)
    profile.ts       → completitud 5×20 % + copy dinámico
    encode-logo.ts   → pipeline del logo en CLIENTE (webp ≤512 + thumb 144)
    supabase/        → client / server / service (+ Storage branding) / middleware
  supabase/
    migrations/  → esquema: 0001_auth_skeleton · 0002_profile_fields · 0003_projects_owner_default (idempotentes, sin DROP)
    ops/         → reparaciones re-ejecutables: 0901 backfill · 0910 grants · 0920 purga R8
  tests/         → Vitest (unit); Playwright en la posición 8
  three/         → motor 3D (pos 3): lathe-builder.ts · visual-skeleton.ts (+ three/README.md)
```

## Setup desde cero

1. **Paquetes**: `npm install` (Node ≥ 20; probado con Node 24 / npm 12).
2. **Supabase** → crear proyecto en [supabase.com] con región **sa-east-1** (latencia regional, §6 de la guía).
3. **Migraciones** (SQL Editor, en orden — las tres idempotentes, sin DROP):
   1. `supabase/migrations/0001_auth_skeleton.sql` — users/projects/pricing + trigger + RLS.
   2. `supabase/migrations/0002_profile_fields.sql` — columnas de perfil (brand_name, logo_url,
      logo_thumb_url, whatsapp_e164, instagram_handle, location, deleted_at) + CHECKs.
   3. `supabase/migrations/0003_projects_owner_default.sql` — default de `user_id` en `projects`
      (logra que el INSERT del autosave tome la sesión vigente; posición 3).
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
| Consola del editor: `[projects] save: "new row violates row-level security policy"` | `projects.user_id` sin default (fila nacida con la 0001 previa a `0003`): el INSERT del autosave no sabe de quién es | correr `supabase/migrations/0003_projects_owner_default.sql` (re-ejecutable) y cambiar algo en el editor para re-disparar el autosave |
| Todos los campos de `/perfil` fallan con `permission denied for table users` (y el logo dice "Storage caído") | grants de users cortos (la 0910 inicial solo daba select a `authenticated`; nada para `service_role`) — GRANT se evalúa antes de la RLS | correr de nuevo `supabase/ops/0910_base_grants.sql` (actualizado y re-ejecutable); en el logo, la ruta ahora distingue fallo de Storage (503) de fallo de fila (500) |
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

**QA corrida con sesión real (04-nov)** — subir el logo (preview + indicador ✅) y guardar los
5 campos ✅ (ambos flujos tras re-correr el `ops/0910_base_grants.sql` ampliado). Queda para
cuando prefieras (no bloquea): eliminar la cuenta de prueba y ver el bloqueo neutro del re-login.

## ¿Qué quedó de la posición 3? (según `spec_tipo_de_mate.md`)

| Requisito | Estado |
| :--- | :--- |
| Catálogo R1 solo-datos: Camionero/Imperial con coordenadas verbatim; producto nuevo = 1 entrada | ✅ `lib/catalog.ts` |
| Selector segmentado (radio-cards) con siluetas SVG derivadas del perfil (sin mini-renders 3D) | ✅ |
| Escena 3D real: cuerpo de torno desde el catálogo + banda metálica de virola (esqueleto de pos 4) | ✅ |
| R4 anti-fuga: labio del cuerpo 1 mm bajo la virola — sin ranura visible para D_int 50–150 | ✅ (test del labio) |
| QA1 panza distinguible: ratio de radios ≥ 1.25 | ✅ test matemático |
| R8 fallback a Camionero ante id desconocido + descarte de entradas corruptas (§6) | ✅ tests |
| Autosave 2 s en `projects.state` con borrador local, banner offline y backoff al reconectar | ✅ código |
| QA2 swap < 300 ms y QA3 restore al reabrir | ⬜ tu QA visual (con dev server) |

**Smoke**: `/editor` sin sesión 307→`/auth` · `/auth` 200. Builds con el motor 3D en chunk lazy
(`dynamic`, `ssr:false`).

**Tu QA visual** (`npm run dev` + login): alternar los dos productos varias veces (sin
parpadeo, órbita intacta), mirar la unión metal/cuerpo en la panza del Imperial y cortar la
red un momento para ver el banner del borrador local.

## ¿Qué quedó de la posición 4? (según `spec_tecnica_geometrica_guias_y_rotacion_360.md`)

| Requisito | Estado |
| :--- | :--- |
| Anatomía 3 mallas: corona superior plana (grabado/guías) + faldón exterior liso + pared interior boca | ✅ `three/lathe-builder.ts` (`buildVirolaTopGeometry`, `buildVirolaOuterWallGeometry`, `buildVirolaInnerWallGeometry`) |
| Guías coplanares en corona superior plana (plano X-Z): bordes concéntricos R_int/R_ext, centro R_centro y ejes 12h/6h radiales con ticks | ✅ `three/guides.ts` + `studio-scene.tsx` |
| Restricciones duras D_ext [70..180], D_int [50..150], paso 0.5 y W ≥ 4.0 mm con rangos dinámicos | ✅ `lib/virola.ts` (reconcileDiameters, intRangeFor, extRangeFor) |
| Métricas auto-calculadas D_centro y W_banda (1 decimal, mm) | ✅ `virolaMetrics()` |
| Cascada única `virola.dimensionsChanged` (<100 ms) | ✅ `lib/virola/cascade.ts` (latencia QA2 <0.1 ms/corrida) |
| Persistencia del estado de guías (`guidesState: { bordes, centro, ejes }`) | ✅ store del editor + `projects.state` |
| Tarjeta "Medidas de la Virola" en panel apilado (inputs, steppers ±0.5, sliders dinámicos, métricas y checkboxes) | ✅ `components/studio/dimensions-card.tsx` |
| Auto-giro del editor a 0.75 RPM con pausa por interacción (OrbitControls) y botón Girar/Pausar | ✅ `AutoSpin` + `components/studio/auto-giro-bar.tsx` |
| Fix de bucle infinito en React 19 / Zustand (selectores memoizados) | ✅ `components/studio/studio-scene.tsx` |

## Scripts

```bash
npm run dev         # editor + API
npm run build       # build de producción (typecheck incluido)
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (matriz R2 + branding + catálogo + virola, 75 tests)
```

## Roadmap (fuente: `../simulador_Mates/orden_de_implementacion.md`)

1. ✅ **Esqueleto Auth** — probada de punta a punta en el proyecto real de Supabase (04-nov)
2. ✅ **Perfil + `resolveBranding()`** — commiteada (`3cf09d0`); `0002` aplicada y QA del panel OK (04-nov)
3. ✅ **Catálogo de mates + escena 3D + autosave** — commiteada (`db31c08`); `0003` + grants aplicados (04-nov)
4. ✅ **Medidas/guías + cascada + virola 3 mallas** — commiteada (05-nov)
5. ⬜ **Color PBR + quemado adaptativo** — `spec_seleccion_de_color` ← siguiente
6. ⬜ Rotación del diseño — `spec_rotacion_...`
7. ⬜ Escala + alerta de chorreo — `spec_escala_y_alerta_...`
8. ⬜ Protección (watermark, 402) — auth paso B
9. ⬜ Ficha técnica export — `spec_detalle_del_modelo_en_ficha`
10. ⬜ Links comerciales + pagos MP — links + `spec_pagos`

Cada bloque de trabajo se abre leyendo la spec fuente: los números (latencias,
límites, constantes) solo se cambian allí y de ahí se re-verifican los consumidores.
