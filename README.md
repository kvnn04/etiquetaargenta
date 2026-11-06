# Simulador Mates 3D — SaaS MVP

Simulador 3D para talleres de grabado láser: configuran el mate, lo comparten con su
cliente por enlace y cierran la venta. Implementación del paquete de especificaciones
`../simulador_Mates/` (9 specs + guía de stack + orden de construcción).

**Estado**: ✅ Posición 9 de 10 — *Ficha técnica + Foto HD (modal `#quoteModal`)*: snapshot inmutable al abrir (badge "Actualizado a las HH:MM" + Actualizar), grilla de **9 tarjetas / 3 secciones** con formatos exactos (`123.0 mm` siempre 1 decimal, banda auto W=(Dext−Dint)/2, `92%`/`92.5%`, `45°`/`45.5°`, faltante ⇒ `—`), descriptores fijos (`#2A2A2A · Anodizado Personalizado`, `#E6C48E · Color Libre`), observaciones (280 máx, ≤ 2 líneas con `…` preservando palabras, viven en sesión), export **PNG HD 2× lado mínimo 2160 px ≤ 5 MB** (`makeQuoteCanvas`, render con las 4 luces EXACTAS de la escena y sin watermark, vía el compositor compartido `lib/compose-engraving.ts`) + **PDF A4** envoltorio del mismo PNG (pdf-lib) + **Foto HD** (2560 px) y **ticket server-side verificado** (`/ticket` → `/ticket/verificar`, hash ligado, UNA re-emisión; FREE ⇒ 402 + Paywall) + registro QA (`GET /api/exports`). Confirmación de desborde ANTES de exportar con los CTA exactos "Exportar de todas formas" / "Volver a ajustar". Sobre las 1–8: auth, perfil/branding, catálogo+escena, medidas/guías, color PBR, rotación, escala/desborde y protección FREE (watermark cocida + 402). Quedan links + Mercado Pago (10).
209 tests pasando en Vitest, build de producción 14 rutas 100% verde y TypeScript strict 0 errores.
Mapa completo y evidencia: `PROYECTO.md`.

---

## Stack (posiciones 1–4)

| Capa | Hoy |
| :--- | :--- |
| Framework | Next.js **15.5** (App Router) + React 19 + TypeScript strict |
| Estilos | Tailwind CSS v4 (CSS-first, `@theme inline`) |
| Backend | Supabase (Postgres + RLS + Auth + Realtime) vía `@supabase/ssr` |
| Estado | Zustand 5 — store del editor (snapshot de `projects.state`) |
| 3D | three 0.187 + @react-three/fiber 9.8 + drei 10.7 (catálogo lathe + virola 3 mallas + PBR pos 5 + grabado rotación/escala/espejo pos 6–7 + guías + pulso de desborde + auto-giro) |
| Test unit | Vitest 4 (209 tests: matriz R2 + branding + catálogo + virola pos 4 + color pos 5 + diseño pos 6-7 + desborde pos 7 + ticket export pos 8 + ficha snapshot/textos pos 9 en `tests/unit/`) |
| PDF | pdf-lib 1.17 (pos 9: envoltorio A4 de la ficha; carga diferida con `import()`, fuera del chunk inicial) |

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
      exports/        → POS 9: GET registro QA ?type=png|pdf (401 sin sesión · snippet {user, plan, artifact, at})
      exports/ticket/ → POS 8: POST ticket de export — plan authoritativo ⇒ FREE 402 PAYWALL / PRO ⇒ HMAC 5 min
      exports/ticket/verificar/ → POS 9: POST contra-verificación (HMAC timing-safe + TTL + hash ⇒ 403 TICKET_INVALIDO)
      profile/logo/   → POST/DELETE del logo (server revalida por magia de bytes)
      profile/delete/ → POST eliminar cuenta (soft + hard delete + signOut)
      auth/exit/      → GET signOut server + redirect con mensaje neutro
    setup/            → página amable si faltan env vars
  components/        → auth / profile / editor / studio / paywall / quote (pos 9) / session / ui
    quote/           → quote-modal.tsx (modal #quoteModal completo) · ficha-render.ts (motor único makeQuoteCanvas) · ficha-pdf.ts (A4 pdf-lib) · foto-hd.ts (Foto HD)
  lib/
    permissions.ts   → MATRIZ R2 (única fuente, alineada a spec_auth §3-R2)
    branding.ts      → resolveBranding() + approvalCode() (fallbacks canónicos R3/R5)
    catalog.ts       → REGISTRO CENTRAL DE PRODUCTOS R1 (+ validación §6 y fallback R8)
    virola.ts        → MEDIDAS DE VIROLA: clamps R1, rangos dinámicos, métricas R2, triada guías R6
    color.ts         → COLOR INTELIGENTE (pos 5): tabla PBR + exclusividad/recientes + quemado R4 (L 0.55)
    design.ts        → DISEÑO DEL GRABADO (pos 6–7): rotación R3 0.5° + imán ±4° + design {rotation, scale, mirror} + asset con base mm congelada
    overflow.ts      → MOTOR DESBORDE (pos 7): envolvente de tinta 512² α≥128 + chequeo 0 mm estricto + largestSafeScalePct R7 (función testeada; UI retirada por decisión del titular) + textos banner/ficha
    compose-engraving.ts → compositor compartido del grabado (extraído en pos 9): Escala→Espejo→Rotación + tinte burn + máscara anular — escena y ficha usan EL MISMO pipeline
    exports/ticket.ts → TICKET DE EXPORT pos 8: HMAC-SHA256 v1 (5 min EXACTOS + verify timing-safe) — la ficha pos 9 pide su descarga con el hash del snapshot
    exports/ticket-server.ts → POS 9: helpers de server compartidos (ticketSecret env + planOf fail-closed) — las 3 rutas de /api/exports usan EL MISMO
    quote/           → POS 9: snapshot.ts (snapshot inmutable + formatos de tarjeta + hash f1 + currentOverflowCheck) · texts.ts (wrapObservations + nomenclatura de archivos) · export-flow.ts (ticket→verificar + cota 5MB + descarga + registro QA)
    store/editor.ts  → zustand: estado del editor = snapshot de projects.state
    projects/        → persistence (restore/upsert + borrador local) · use-autosave (2 s + backoff)
    profile.ts       → completitud 5×20 % + copy dinámico
    encode-logo.ts   → pipeline del logo en CLIENTE (webp ≤512 + thumb 144)
    supabase/        → client / server / service (+ Storage branding) / middleware
  supabase/
    migrations/  → esquema: 0001_auth_skeleton · 0002_profile_fields · 0003_projects_owner_default (idempotentes, sin DROP)
    ops/         → reparaciones re-ejecutables: 0901 backfill · 0910 grants · 0920 purga R8
  tests/         → Vitest (unit; 10 archivos): quote-snapshot + quote-texts (pos 9) · export-ticket (pos 8) · overflow · design · color · virola · catalog · branding · matriz
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
| `402` de export (ticket 5 min), watermark cocida, bloqueo DOM, badge demo reactivo | ✅ posición 8 (links + MP: pos 10) |

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

## ¿Qué quedó de la posición 5? (según `spec_seleccion_de_color.md`)

| Requisito | Estado |
| :--- | :--- |
| Tabla PBR canónica única: 3 presets de cuerpo + 3 metálicos de virola + valores libres anotados | ✅ `lib/color.ts` (32 tests) |
| Cobertura integral de virola: el color tiñe las 3 mallas (corona + faldón + pared interior), guías intactas | ✅ material único memoizado en `VirolaGroup` |
| Exclusividad mutua preset ⇄ color libre + colores recientes (máx 6, dedup, por zona) | ✅ (testeado) |
| Quemado adaptativo R4: preset ⇒ oscuro #2B2118@0.88; hex con L ≥ 0.55 ⇒ oscuro · L < 0.55 ⇒ plateado #C9CCCF@0.92 | ✅ `adaptiveLaserBurn()` (su dibujo aplicado a la escena: pos 6) |
| Descriptor canónico para Ficha/Cotización ("Virola: #2A2A2A · Anodizado Personalizado") | ✅ `formatColorDescriptor()` (consumido por las tarjetas de la ficha pos 9) |
| Persistencia: bodyPreset/metalPreset/bodyColor/virolaColor/recentColors en `projects.state` + normalize tolerante (legacy `topFaceColor`) | ✅ |
| Tarjeta "Materiales y Acabados" en panel apilado (decisión del titular: sin pestañas) | ✅ `components/studio/color-picker-card.tsx` |
| Todo el módulo de color 100% FREE (sin candado) | ✅ (matriz R2 sin capability nueva) |

## ¿Qué quedó de la posición 6? (según `spec_rotacion_archivo_svg_png.md`)

| Requisito | Estado |
| :--- | :--- |
| Marco canónico único: 0° = eje de la costura UV, pivote en el centro del carril, presets "0° Frente / 90° Der / 180° Dorso / 270° Izq" | ✅ ancla `LATHE_SEAM_PHI_START` + canvas polar de la corona |
| Ángulo canónico único en [0°, 360°) paso 0.5° (370°⇒10°, −90°⇒270°, 45.25°⇒45.5°, 360°⇒0) | ✅ `lib/design.ts` (25 tests) |
| Imán configurable ±4° (ON por defecto, SOLO dispositivo — nunca jsonb) + presets exactos siempre + reset a 0° | ✅ `localStorage mocap:design-snap-magnet` ✓ QA3: 17.5° exacto con imán OFF |
| Grabado sobre la corona superior con clipping anular y tinte de quemado adaptativo (R4 pos 5) | ✅ CanvasTexture 1024² en `studio-scene.tsx` — mismo caché de geometría de `virolaTopMesh` |
| El ángulo JAMÁS reconstruye virola ni re-inicializa luces; guías estáticas; auto-giro ajeno | ✅ solo re-compone el canvas |
| Carga SVG/PNG en cliente (raster 1024², R8) con la imagen SOLO de sesión (persiste la rotación) | ✅ `rasterizeDesignFile` + diseño fuera del snapshot |
| Fallo de raster ⇒ conserva la última textura válida + aviso inline (§6) | ✅ |
| Persistencia `design.rotation` en `projects.state` (legacy sin rotation ⇒ 0°) | ✅ normalize tolerante |
| Rotación FREE (sin candado en la matriz R2) | ✅ |
| Re-chequeo de desborde al rotar (R6) | ✅ sustituido por el anclaje real R1 en pos 7 (el ajuste provisional de inscripción era el bug del "SVG invisible") |

## ¿Qué quedó de la posición 7? (según `spec_escala_y_alerta_de_desborde.md`)

| Requisito | Estado |
| :--- | :--- |
| Anclaje del 100 % (R1): el contain-fit del diseño de pos 6 ya toca el anillo al cargar; la base queda congelada en mm (`baseSideMm` = D_ext vigente) y el % multiplica SOLO esa base — editar medidas NO re-escala, solo re-chequea | ✅ `DesignAsset.baseSideMm` + compose FULL-canvas |
| Pipeline canónico Escala → Espejo → Rotación al mismo pivote (espejo aplazado por pos 6) | ✅ `composeEngravingCanvas` (checkbox "Espejo del grabado" en la tarjeta) |
| Escala fina [70, 110] paso 0.5 % con slider/campo WYSIWYG (`.` y `,`, sufijo %) y presets 85/90/100 (sin "Máx") | ✅ sección C "Tamaño / Escala del Grabado" |
| Motor de desborde: escaneo polar exacto de la envolvente de tinta (512², α≥128, R4), tolerancia 0 mm ESTRICTA, desvío en mm (1 decimal), chequeo ≤ 25 ms | ✅ `lib/overflow.ts` (27 tests + QA2 del barrido en test) |
| Disparadores: escala, D_ext/D_int y carga de diseño — girar/espejar JAMÁS re-chequean (invariancia polar R3) | ✅ chequeo O(1) por estado |
| Banner con redacción EXACTA (R5) + guías afectadas con pulso rojo 500 ms | ✅ banner ámbar→rojo (@2 mm anotado) + `PulseGuideLine` `#FF3B30` en la escena |
| Botón Auto (R7): retirado de la UI por decisión del titular (05-nov) — la mayor escala segura la elige el tallerista con slider/banner; `largestSafeScalePct` queda testeada en `lib/overflow` (pos 9/10 pueden reusarla) | 🚫 UI fuera · ✅ función conservada |
| Ficha: "Margen: seguro" / "con riesgo (excede X mm)" (R6) | ✅ `marginSheetLine()` — consumido por la ficha pos 9 (tarjeta Margen) y la confirmación del export |
| §6 modo degradado: raster del chequeo falla ⇒ envolvente (bbox) conservadora + aviso "Detección aproximada" | ✅ `evaluateOverflowBBox` |
| Persistencia: `design.scale`/`design.mirror` en `projects.state` (legacy ⇒ 100 %/OFF; 115⇒110 · 65⇒70 con aviso); el margen JAMÁS se persiste (R8) | ✅ normalize tolerante + envolvente derivada de sesión |
| Escala/espejo/banner/confirmación 100 % FREE (sin candado) | ✅ matriz R2 sin capability nueva |

> **Bug resuelto con la entrega**: el reporte *"el SVG cargado no se visualiza en la virola"* —
> el compositor provisional de pos 6 inscribía el diseño en el hueco (centrado en el eje), la
> máscara anular lo borraba íntegro. El anclaje real R1 de pos 7 (full-canvas, envolvente
> tocando el anillo) lo corrige de raíz.
>
> **Post-entrega (05-nov)**: el reporte *"perdió calidad al subirlo a la virola"* — causas
> diagnosticadas: (1) el SVG nacía rasterizado en su tamaño intrínseco (width/height chicos,
> o 300×150 por defecto) y el bitmap se estiraba a 1024²; (2) el refuerzo de alfa ×1.8
> rompía el anti-aliasing del vector; (3) la CanvasTexture carecía de anisotropía (mipmap
> borroso en ángulos rasantes). Corregido: envoltorio de rasterizado a resolución FINAL,
> refuerzo de alfa SOLO para PNG y anisotropía máxima de la GPU.

## ¿Qué quedó de la posición 8? (según `spec_autenticacion_y_modelo_freemium.md` — paso B)

| Requisito | Estado |
| :--- | :--- |
| Watermark "MODO DEMO · Suscribite para descargar en HD" (R4): semitransparente, cruzada, centrada, COCIDA AL RENDER (segunda pasada ortográfica en el mismo canvas WebGL — las capturas del SO la incluyen, límite declarado) | ✅ `WatermarkLayer` en escena — SOLO plan `free` (`gate('render.no-watermark')`: pro/pro_grace ven render limpio) |
| Bloqueo de rutas DOM (R4): menú contextual del canvas, arrastre de imagen fuera y cero blob URLs expuestos | ✅ `onContextMenu`/`onDragStart` + `select-none` en la sección del estudio cuando FREE |
| 402 en la API de export (R4/QA-3): FREE ⇒ 402 `PAYWALL_REQUIRED` (abre el Paywall, jamás error crudo §6); PRO ⇒ descarga habilitada | ✅ `POST /api/exports/ticket`: sesión por cookies (401/400), plan AUTHORITATIVO desde `users` vía service-role, fail-closed sin fila |
| Ticket server-side firmado (R7 spec_detalle): vigencia EXACTA 5 min, ligado al hash del snapshot | ✅ `lib/exports/ticket.ts` HMAC-SHA256 `v1.<payload>.<mac>` (b64url, timing-safe, 7 tests) — el motor gráfico de la pos 9 lo consume |
| R3 demo: contador que se agota al primer diseño, reemplazo libre dentro del slot | ✅ badge reactivo `(0/1)` → `(1/1)` cuenta el asset de sesión (cuota server-side con conteo en Storage: pos 10) |
| 2do diseño/proyecto + "Reiniciar proyecto" bloqueados (R3) | 🔜 sin UI nueva por decisión del titular — ya conectables vía `gate()` cuando existan |
| El precio JAMÁS hardcodeado y sin paywall técnico: CTA MP se activa con Checkout Pro (pos 10) | ✅ Paywall modal intacto (precio de `/api/config/pricing`), CTA deshabilitado honesto |

## ¿Qué quedó de la posición 9? (según `spec_detalle_del_modelo_en_ficha.md`)

| Requisito | Estado |
| :--- | :--- |
| Snapshot inmutable al abrir (R1): badge "Actualizado a las HH:MM" + botón Actualizar re-captura; JAMÁS en `projects.state` (sin entidades DB nuevas) | ✅ `lib/quote/snapshot.ts` (`captureFichaSnapshot`, transitorio en memoria) + hash `f1:` del contenido EXCLUYENDO `capturedAt` |
| Grilla 9 tarjetas / 3 secciones con formatos EXACTOS (R2): `123.0 mm` SIEMPRE 1 decimal, banda auto W=(Dext−Dint)/2, `92%`/`92.5%`, `45°`/`45.5°`, faltante ⇒ `—` | ✅ formatos testeados (24 tests snapshot) + grilla React espejo + las MISMAS tarjetas dibujadas en `makeQuoteCanvas` |
| Descriptores FIJOS (R3): `#2A2A2A · Anodizado Personalizado` / `#E6C48E · Color Libre`, presets por su nombre, NUNCA auto-nombres | ✅ consumidos de `formatColorDescriptor` (pos 5) por grilla y canvas |
| Degradación de marca via `resolveBranding()` único (R4): white-label SOLO PRO, iniciales/fallback título, IG/WA removidos si faltan; jamás bloquea el export | ✅ `captureFichaSnapshot` con brand resuelto + pie condicional del canvas |
| Observaciones máx 280 + contador (R5): canvas ≤ 2 líneas con `…` preservando palabras; sin texto ⇒ sin bloque; el texto de sesión sobrevive re-abrir + chip "sin capturar" | ✅ `wrapObservations` (`lib/quote/texts.ts`, 16 tests) + obsText en la shell |
| Único motor `makeQuoteCanvas` (R6): PNG 2× lado mínimo 2160 px ≤ 5 MB; PDF = envoltorio A4 del MISMO PNG con pie del taller + linkId si corresponde | ✅ `ficha-render.ts` (render con las 4 luces EXACTAS de la escena, sin guías/watermark, JPEG intermedio con escalada .8/.6/.45) + `ficha-pdf.ts` (pdf-lib A4, fuentes estándar + saneo WinAnsi) |
| Export con ticket server-side (R7): FREE ⇒ 402 + Paywall, PRO ⇒ descarga; ticket 5 min ligado al hash; verificar antes de adjuntar | ✅ `ensureVerifiedTicket` (`export-flow.ts`): `/ticket` → `/ticket/verificar` (403 TICKET_INVALIDO) + UNA re-emisión — el candado 🔒 de UI es decorativo, la decisión la toma el server |
| Fallbacks (R8): modelo desconocido ⇒ "Mate Camionero", escala/rotación ausentes ⇒ 100 %/0°, datos inválidos ⇒ `—` + aviso en consola | ✅ `formatModeloCard` + `vigente()` con `console.warn` (testeado) |
| Confirmación de desborde ANTES de exportar con CTA EXACTOS "Exportar de todas formas" / "Volver a ajustar" (Ficha Y Foto HD) | ✅ panel interno del modal (`overflowBannerText` pos 7) + mini-diálogo Promise-based en la shell |
| Foto HD: render solo, misma infra de ticket+confirmación, sin grilla | ✅ `components/quote/foto-hd.ts` — 2560 px lado (escalado a 2160 exactos si excede 5 MB) |
| "Sin diseño cargado" = sin archivo en slot de sesión: Grabado placeholder, Producto/Acabados imprimen igual (decisión del titular); el modal lo ofrece a FREE también | ✅ `grabadoSinDiseno` ⇒ tarjetas con placeholder; server decide via 402 |
| Registro QA de exports: consola del server `{user, plan, artifact, at}` (sin tablas nuevas) | ✅ `GET /api/exports?type=png|pdf` + `POST /api/exports/ticket/verificar` (401/400/403/200) |
| Nomenclatura §5: `{taller}-ficha-mate-{model}-{aaaammdd}.png\|pdf` y `{taller}-foto-mate-{model}-{aaaammdd}.png` | ✅ `slugTaller` + `formatFileDate` en `texts.ts` (testeado con el ejemplo exacto de la spec) |
| La escena y la ficha comparten pipeline del grabado (un solo motor) | ✅ `composeEngravingCanvas` extraída a `lib/compose-engraving.ts` — studio-scene y ficha-render la importan |

## Scripts

```bash
npm run dev         # editor + API
npm run build       # build de producción (typecheck incluido)
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (matriz R2 + branding + catálogo + virola + color + diseño + desborde + ticket export + ficha snapshot/textos, 209 tests)
```

## Roadmap (fuente: `../simulador_Mates/orden_de_implementacion.md`)

1. ✅ **Esqueleto Auth** — probada de punta a punta en el proyecto real de Supabase (04-nov)
2. ✅ **Perfil + `resolveBranding()`** — commiteada (`3cf09d0`); `0002` aplicada y QA del panel OK (04-nov)
3. ✅ **Catálogo de mates + escena 3D + autosave** — commiteada (`db31c08`); `0003` + grants aplicados (04-nov)
4. ✅ **Medidas/guías + cascada + virola 3 mallas** — commiteada (`feca766`, 05-nov)
5. ✅ **Color PBR + quemado adaptativo** — commiteada (`940e69c`, 05-nov)
6. ✅ **Rotación del diseño (grabado)** — commiteada (`f31fa32`, 05-nov)
7. ✅ **Escala fina 70–110 % + desborde (chorreo) + espejo** — commiteada (`b8cb203`; post-entrega `141f094`: Auto retirado por decisión del titular + nitidez SVG)
8. ✅ **Protección FREE (watermark cocida, bloqueo DOM, 402 ticket)** — auth paso B, commiteada (05-nov)
9. ✅ **Ficha técnica + Foto HD + registro QA** — modal `#quoteModal` (snapshot + 9 tarjetas + PNG 2160 ≤5MB + PDF A4 + ticket verificar), commiteada (06-nov)
10. ⬜ Links comerciales + pagos MP — links + `spec_pagos` ← siguiente

Cada bloque de trabajo se abre leyendo la spec fuente: los números (latencias,
límites, constantes) solo se cambian allí y de ahí se re-verifican los consumidores.
