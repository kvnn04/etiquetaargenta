# 🧉 PROYECTO.md — Simulador Mates 3D (ubicación: *"leeme primero"*)

> **Este archivo es la puerta de entrada al repo.** Resume qué es este proyecto, qué quedó
> implementado hasta ahora y por qué, sin necesidad de leer las specs ni el código primero.
> Cuando un detalle se necesite con exactitud, el final de cada sección dice **qué spec es
> su fuente de verdad** (y esas specs solamente se leen cuando toque).

---

## 1. Qué es este proyecto

Un **SaaS B2B para talleres de grabado láser** que venden mates personalizados:

1. El taller configura el mate en **3D** (modelo, virola metálica milimétrica, diseño SVG/PNG,
   colores, acabados).
2. Genera un **link comercial** y se lo manda al cliente por WhatsApp.
3. El cliente abre el link, gira el mate 360°, elige una variante y aprueba.
4. El taller cierra la venta; la herramienta cobra una **suscripción mensual (Plan PRO)** vía Mercado Pago.

Todo lo que se construye acá proviene de un **paquete de especificaciones cerradas**:
`../simulador_Mates/` (fuera de este repo), que contiene:

| Documento | Rol |
| :--- | :--- |
| `README.md` | Índice del paquete + §5 **Contratos Transversales** (cada regla vive en UNA spec) |
| 9 archivos `spec_*.md` | Reglas de negocio, cálculos, UI y criterios QA por módulo |
| `guia_de_tecnologias.md` | Stack decidido (Next.js App Router + R3F + Supabase + Mercado Pago) y riesgos |
| `orden_de_implementacion.md` | Secuencia de construcción en **10 posiciones / 3 olas** |

Además existe un **prototipo visual de referencia** (fuera del repo):
`../Mate_Studio_Premium_Cliente v1.html` — un HTML de un solo archivo con Three.js que ya demuestra las ideas
nucleares (virola asible, guías, escala anti-chorreo, ficha comercial). Es la inspiración
estética y conceptual, **no** la implementación.

**Fuente de verdad:** `../simulador_Mates/README.md` (contratos) — este repo la *consume*, nunca la *duplica*.

---

## 2. Dónde estamos: posición 2 de 10 ✅

El orden de construcción (`orden_de_implementacion.md`) manda **perchas primero — caja al final**:

```
1. ✅ ESQUELETO AUTH
2. ✅ Perfil + resolveBranding()   ← ESTAMOS ACÁ
3-7. ⬜ Editor 3D (catálogo → medidas/guías → color → rotación → escala/chorreo)
8. ⬜ Protección (watermark cocida, bloqueo de rutas DOM, 402 export)
9. ⬜ Ficha técnica export (PNG ≥2160px + PDF A4)
10. ⬜ Links comerciales + Mercado Pago (se cobra recién cuando existe todo)
```

La posición 2 entregó el **Panel de Perfil** (`/perfil`), la **librería única de branding**
(`resolveBranding()` — fallbacks canónicos que consumirán ficha/visor/CTA desde las posiciones
6–10) y la **Zona de peligro** (eliminar cuenta, R8). Único pendiente operativo: correr la
migración `0002_profile_fields.sql` en el SQL Editor (checklist §7) — hasta entonces las páginas
que leen las columnas nuevas fallan en el proyecto real con *"column does not exist"*.

Se empezó por las posiciones 1–2 (y no por el editor) porque toda la plataforma vive detrás del
login y la identidad del taller es la **materia prima** del editor y de los links futuros: de acá
sale el branding que la ficha imprima (R3/R5) y el `state` que la posición 3 engancha a `projects`.

**Fuente de verdad de esta entrega:** `../simulador_Mates/spec_especificaci_n_tecnica_datos_de_usuario_y_registro.md`
(la matriz R2 sigue implementada en `lib/permissions.ts` y citada desde `spec_autenticacion_y_modelo_freemium.md`).

---

## 3. Stack (y por qué está fijado como está)

| Capa | Tecnología | Versión | Nota |
| :--- | :--- | :--- | :--- |
| Framework | Next.js App Router | **15.5.29** | línea estable; Next 16 requiere re-validar middleware/TS |
| Runtime UI | React | 19.1.10 | futura base de R3F v9 (posiciones 3–7) |
| Lenguaje | TypeScript strict | **6.x** | TS 7 nativo aún NO soportado por Next 15.5 |
| Estilos | Tailwind CSS | 4.3.4 | CSS-first (`@theme inline`), sin `tailwind.config` |
| Backend / Auth / DB | Supabase (`@supabase/supabase-js` + `@supabase/ssr`) | 2.119 / 0.12 | Postgres + RLS + Auth + Realtime |
| Iconos | lucide-react | latest | |
| Test unit | Vitest | 4.1.12 | hoy: 31 tests (matriz R2 + branding) |
| Se instalan SOLO al llegar su posición | `three`, `@react-three/fiber`, `@react-three/drei`, `zod`, `pdf-lib`, `sharp`, `mercadopago`, Playwright | — | no adelantar deps |

**Decisión de alias:** TS ≥6 eliminó `baseUrl`, y Next 15.5 no translada `paths` de tsconfig sin
ese prefijo: el alias `@/*` está declarado explícitamente en `next.config.mjs` (webpack +
turbopack) **y** en `tsconfig.json`.

**Known-issue documentado:** `npm audit` marca 2 vulnerabilidades de `postcss ≤8.5.22` arrastradas
por Next 15.5 (build-time; no afecta runtime con CSS propio). El "fix" propuesto fuerza Next 16
(breaking) — se revisa en la posición 8.

**Windows tip:** si `npm` falla con *Execution Policy (npm.ps1)*, usar `npm.cmd` (el problema es
solo el shim de PowerShell).

---

## 4. Mapa del repo — qué es cada archivo y qué lo justifica

```text
simulador-mates/
├── PROYECTO.md                    ← estás acá
├── README.md                      ← manual de setup operativo (Supabase, envs, scripts)
├── middleware.ts                  ← gating de rutas: crea el client de sesión (lib/supabase/middleware)
├── next.config.mjs                ← alias @/* (webpack + turbopack)
├── tsconfig.json / postcss.config.mjs / vitest.config.ts
├── .env.local.example             ← plantilla de las 3 keys de Supabase (+ futuras MP)
│
├── app/
│   ├── layout.tsx · globals.css   ← shell + tokens de la paleta premium (oro/negro)
│   ├── page.tsx                   ← "/" ⇒ /editor (sin sesión, el server manda al visitante a /auth)
│   ├── global.d.ts                ← declara los módulos *.css (TS ≥6)
│   ├── setup/page.tsx             ← página amable cuando faltan env vars (NUNCA un 500 pelado)
│   ├── auth/page.tsx              ← Auth Overlay (con sesión ⇒ /editor; `?cuenta=…` ⇒ banner neutro R8)
│   ├── auth/callback/route.ts     ← PKCE: intercambia ?code= por sesión (OAuth/email-verify)
│   ├── perfil/page.tsx            ← PANEL DE PERFIL: 5 campos + completitud + logo + zona de peligro
│   ├── (editor)/editor/page.tsx   ← shell del editor: sesión + plan + guard `deleted_at`, SIEMPRE server
│   └── api/
│       ├── config/pricing/route.ts ← GET precio del plan desde pricing_config (200; 404 si no hay fila)
│       ├── profile/logo/route.ts   ← POST subida (server revalida por magia de bytes) / DELETE quita logo
│       ├── profile/delete/route.ts ← POST eliminar cuenta: soft-delete + hard-delete proyectos + signOut
│       └── auth/exit/route.ts      ← GET signOut server + redirect /auth?cuenta=inhabilitada
│
├── components/
│   ├── auth/auth-overlay.tsx      ← Google OAuth + email/contraseña + olvidaste tu contraseña
│   ├── profile/profile-panel.tsx  ← tarjetas con guardado inline, indicador 5×20 %, drag&drop del logo
│   ├── profile/danger-confirm.tsx ← doble confirmación R8 (palabra ELIMINAR + botón final)
│   ├── editor/editor-shell.tsx    ← top bar + placeholder 3D + panel "Matriz R2" + acciones gated
│   ├── editor/top-bar.tsx         ← badge por plan + logo/iniciales + ícono Perfil (todas las plans)
│   ├── paywall/paywall-modal.tsx  ← laurel: precio dinámico + beneficios + CTA MP (desactivado: pos 8–10)
│   ├── session/plan-watcher.tsx   ← Realtime: UPDATE en users ⇒ router.refresh() (sin reload)
│   └── ui/{button,input}.tsx      ← primitivas mínimas (cva), patrimonio de shadcn/ui a futuro
│
├── lib/
│   ├── permissions.ts             ← ★ MATRIZ R2 como ÚNICA FUENTE implementada (gate/isLockedFor)
│   ├── branding.ts                ← ★ resolveBranding() + approvalCode() + normalizadores (R3/R5)
│   ├── profile.ts                 ← completitud 5×20 % + copy dinámico del panel (cliente-only)
│   ├── encode-logo.ts             ← pipeline del logo EN CLIENTE: webp ≤512 + thumb 144 (R4)
│   ├── cn.ts                      ← clsx + tailwind-merge
│   ├── types/db.ts                ← tipos mínimos de filas (users / pricing_config)
│   └── supabase/
│       ├── middleware.ts          ← updateSession: refresh de token + redirects (visitor⇒/auth, con sesión⇒/editor)
│       ├── server.ts              ← client server-side (cookies)
│       ├── client.ts              ← client de navegador
│       └── service.ts             ← SERVICE ROLE + Storage: bucket branding lazy + URLs firmadas
│
├── supabase/
│   ├── migrations/
│   │   ├── 0001_auth_skeleton.sql     ← users + trigger nombre derivado + projects + pricing_config + RLS + Realtime
│   │   └── 0002_profile_fields.sql    ← ⬜ POR CORRER: columnas de branding + CHECKs + deleted_at (sin DROP)
│   └── ops/
│       ├── 0901_backfill_user_rows.sql ← reparación: fila faltante en public.users (cuenta nacida pre-migración)
│       ├── 0910_base_grants.sql        ← reparación: 'permission denied' (proyectos sin grants automáticos)
│       └── 0920_purge_deleted_accounts.sql ← R8: restauración manual + purga a 30 días (soporte / pg_cron)
│
├── tests/
│   ├── unit/permissions.test.ts   ← 8 tests: invariantes de la matriz R2
│   └── unit/branding.test.ts      ← 23 tests: fallbacks, CTA R5, E.164, Instagram, completitud
├── three/README.md                ← qué va a alojar el motor 3D cuando llegue (posiciones 3–7)
└── (node_modules / .next / package-lock…)
```

---

## 5. Lo que quedó implementado (posiciones 1–2) — con su criterio QA

**Fuente:** `spec_autenticacion_y_modelo_freemium.md` §7 (aceptación) + spec registro §3-R1.

| # | Criterio | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| 1 | Visitante ⇒ redirect inmediato al Auth Overlay | `middleware` revisa `getUser()` en cada request | ✅ verificado por smoke (307 `/`→`/setup` sin envs) |
| 2 | Login (Google o email) aterriza en el editor | overlay → `/auth/callback` (PKCE) → `/editor` | ✅ |
| 3 | Reabrir <30 días no pide re-login (refresh rotativo) | cookies + refresh en cada navegación | ✅ |
| 4 | Logout limpia local sin borrar proyectos del server | `signOut()` — RLS preserva las filas | ✅ |
| 5 | Registro de 2 campos, nombre derivado (`kevin.firma` ⇒ *"Kevin Firma"*; inutilizable ⇒ `"MI TALLER"`) | SQL función `derive_base_name` + trigger `handle_new_user` (ÚNICA implementación: en la DB; el cliente nunca re-deriva) | ✅ |
| 6 | Matriz R2 única fuente citable por las demás specs | `lib/permissions.ts` + test unit | ✅ (8/8 tests) |
| 7 | Gating de UI: 🔒 decorativo, cada intento abre el Paywall (nunca error técnico) | TopBar/EditorShell consultan `gate()`; locked ⇒ modal | ✅ |
| 8 | Precio impreso desde el backend (`pricing_config`), nunca hardcodeado | `GET /api/config/pricing` con service-role | ✅ (200 en runtime; antes requería el grant de `ops/0910`) |
| 9 | PRO_GRACE (dunning) visible con cuenta regresiva de días | badge ámbar calculado en shell | ✅ (el ciclo real llega con pagos) |
| 10 | Desbloqueo realtime en todas las pestañas sin reload | `plan-watcher` (canal `users`) | ✅ (se demostrará al pagar pos 8–10) |
| 11 | Slot 1/1 del demo, watermark, 402 de export | 🔜 posiciones 8–10 | ⬜ |

**Fuentes de datos creadas en Supabase:**
- `users`: `plan` (`free|pro|pro_grace`) — donde vive el rol **de verdad** (el JWT es cache);
  `grace_expires_at`, `mp_preapproval_id`, `base_name` (nombre derivado).
- `projects`: snapshot `jsonb` del editor (`state`) + RLS `own_projects` — la consumen las
  posiciones 3–7 (autosave debounce 2s, `last-write-wins`).
- `pricing_config`: única fila `pro_monthly_ars` (ARS) — el responsable del SaaS la edita a mano.
- Trigger `on_auth_user_created` en `auth.users` (convierte email/Google ⇒ nombre).
- Realtime: `public.users` agregada a la publicación `supabase_realtime`.

### Posición 2 — Perfil + branding + R8 (según `spec_..._datos_de_usuario_y_registro.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R3 | Degradación canónica con fallbacks ÚNICOS | `resolveBranding()` en `lib/branding.ts`: título (comercial → derivado → plataforma), iniciales, fila de Instagram oculta si falta | ✅ (23 tests) |
| R4 | Logo webp/png ≤512 px + thumb 144 · original jamás persistido | encode en cliente (canvas, `lib/encode-logo.ts`) + server revalida magia de bytes/dims/peso; solo PATHS en la fila; bucket privado `branding` (lazy) + URL firmada 1 h al render | ✅ |
| R5 | CTA: WhatsApp (E.164) o código `APROBADA-{VARIANTE}-{LINKID}` — jamás un `wa.me` inválido | `approvalCode()` + campo `cta` del resolver | ✅ su CONSUMO en ficha/visor llega con pos 6–10 |
| R2 | Ubicación jamás impresa en outputs | `resolveBranding` ni siquiera la devuelve (`ResolvedBranding` no la contiene); el panel la rotula "solo para tu perfil" | ✅ (testeado) |
| R7 | `email_verified` | derivado de `auth.users.email_confirmed_at` (sin columna SQL — decidido 04-nov); el panel muestra el flag; el gate "verificado para pagar" intercepta la compra en pos 8–10 | ✅ / ⬜ intercept |
| R8 | Baja de cuenta con doble confirmación | modal en pantalla (palabra `ELIMINAR` + botón final) → `users.deleted_at` + hard-delete de proyectos (RLS) + signOut; re-login bloqueado con mensaje neutro; restauración/purga 30 días vía `ops/0920` | ✅ variante en pantalla (el LINK por email llega con el mailer, pos 8–10) |
| §4 | Indicador "Perfil al X %" = 5 campos × 20 % con copy | `lib/profile.ts` (cálculo cliente; ninguna regla de negocio depende de él) | ✅ |
| R6 | Aviso "links desactualizados" al cambiar el perfil | exige links vivos (pos 10); el contrato ya está fijado en la regla inmutable #5 (§9) | ⬜ diferido |

**Decisiones recordadas de la entrega** (preguntas respondidas por el titular 04-nov):
encode del logo en **cliente** (canvas — `sharp` sigue reservado para la posición 9), R8 sin mailer
con **doble confirmación en pantalla** (traerá link por email el mailer de 8–10, que además suma
los Emails de sistema de §5: confirmación de email, confirmación de borrado y aviso 7 días
antes de la purga si la cuenta tenía proyectos), y `email_verified` **derivado de auth**
por la fuente única de Supabase.

El logo en outputs es **white-label PRO** (matriz R2, capa `brand.output.white-label`): el taller
ve su logo en el workspace y header SIEMPRE, pero la ficha/visor solo lo imprimen con plan PRO.

---

## 6. Cómo fluye en runtime (recorrido de un usuario real)

```
visitante                        con sesión
─────────                        ──────────
/ (cualquier ruta)               abre el app
│                                │
middleware: ¿user?               middleware: refresh token + ¿user?
├─ sin sesión ⇒ /auth           └─ va directo a /editor
│                                 │
│   Auth Overlay                  (editor)/editor/page.tsx (server)
│   ├─ Google OAuth (PKCE)          ├─ users.plan desde la base (NO del JWT)
│   ├─ email+contraseña             ├─ EditorShell renderiza según plan:
│   └─ olvidaste…(email neutral)     │   free      ⇒ badge DEMO + botón verde + candados
│                                    │   pro_grace ⇒ badge ámbar "te quedan X días"
└─ /auth/callback ⇠ code             │   pro       ⇒ badge ✓ + menú (Perfil/Portal/Logout)
   (intercambia y vuelve al editor)  └─ acciones gated clic ⇒ Paywall (precio de /api/config/pricing)

TRIGGER DB al crear cuenta: users.base_name derivado del email / nombre de Google.
```

El **Panel de Perfil** (`/perfil`) suma su propio flujo (posición 2):

```
ícono Perfil de la top bar (todas las plans) / menú PRO
│
/perfil (server): fila users + URLs firmadas de los logos (1 h)
├─ deleted_at activo ⇒ /api/auth/exit ⇒ /auth?cuenta=inhabilitada (R8)
└─ panel: guardado inline por RLS (UPDATE en users) + logo vía /api/profile/logo
   ├─ CLIENTE: canvas re-encodea webp ≤512 px + thumb 144 (el original NUNCA sube)
   └─ SERVER: revalida bytes/dims/peso ⇒ bucket privado branding + PATHS en la fila
Zona de peligro: ELIMINAR ⇒ soft-delete cuenta + hard-delete proyectos + signOut
             ⇒ re-login bloqueado con mensaje neutro (restore vía ops/0920, 30 días)
```

---

## 7. Estado de configuración externa (checklist operativo)

| Ítem | Estado |
| :--- | :--- |
| `npm install` local | ✅ (106 paquetes) |
| Proyecto Supabase (sa-east-1) | ✅ por el usuario |
| Migración `0001_auth_skeleton.sql` | ✅ ejecutada en el proyecto real (idempotente, sin DROP; los grants también quedaron embedidos en el archivo) |
| **Migración `0002_profile_fields.sql`** | ⬜ **pendiente de correr por el usuario en el SQL Editor** — idempotente y sin DROP; hasta entonces `/perfil` y las páginas que leen las columnas nuevas fallan (`column does not exist`) |
| Bucket Storage `branding` | ➖ no requiere acción: se crea SOLO (lazy) en la primera subida de logo, con service role (privado — las URLs a las vistas se firman 1 h) |
| Grants base (users / projects / pricing) | ✅ aplicados via `ops/0910_base_grants.sql` — el proyecto del usuario NO aplicaba GRANT automáticos |
| Google provider en dashboard | ⬜ no configurado — el camino probado fue email+contraseña (funciona sin esto) |
| `Confirm email = OFF` en dashboard | ✅ apagado 04-nov tras tropezar con el límite de emails (regla "fricción cero" R1) |
| Replicación realtime de `public.users` | ⬜ (Dashboard → Database → Replication) — hace falta desde que existan cambios de plan (pos 8–10) |
| `.env` con `URL + ANON + SERVICE_ROLE_KEY` | ✅ el usuario optó por archivo `.env` y Next declara "Environments: .env" — `.env` y `.env.local` valen ambos |

### Incidentes reales vividos en el primer setup → cómo quedaron resueltos

| Incidente observado | Causa real | Solución (dónde quedó) |
| :--- | :--- | :--- |
| `pricing_config read error: permission denied` (`GET /api/config/pricing 500`) | el proyecto no aplica los GRANT automáticos de Supabase sobre tablas creadas por SQL editor | `grant select on pricing_config to service_role` — embebido en `0001` y reproducible en `ops/0910_base_grants.sql` |
| Cartel "No existe fila en public.users" persistente | `(a)` cuenta nacida ANTES del trigger (los triggers no se aplican retroactivamente) + `(b)` el editor tragaba el error de lectura | backfill `ops/0901_backfill_user_rows.sql`; además el editor ahora logea el error real en la terminal |
| Re-crear un email ya borrado fallaba ("No pudimos crear la cuenta") | Confirm email ON ⇒ cada registro dispara email ⇒ tope de emails por hora en el plan free | Confirm email = OFF (estado correcto del producto según la spec — fricción cero) |
| Sin botón de cerrar sesión con plan free | el logout solo existía dentro del menú visible para PRO | fix top-bar: icono de sesión siempre disponible (commit `c8edbcf`) |

**Verificación SQL post-migración** (copiable en el SQL Editor):

```sql
select public.derive_base_name('kevin.firma@correo.com');  -- "Kevin Firma"
select public.derive_base_name('12345@correo.com');        -- "MI TALLER"
select * from pricing_config;                              -- pro_monthly_ars · 20000 · ARS
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in ('users','projects');  -- 2 filas rowsecurity=true
```

Tras correr `0002_profile_fields.sql` (posición 2), verificar con:

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'users'
   and column_name in ('brand_name','logo_url','logo_thumb_url',
                       'whatsapp_e164','instagram_handle','location','deleted_at');
-- esperado: 7 filas
```

---

## 8. Verificación técnica de esta entrega (evidencia)

| Check | Resultado |
| :--- | :--- |
| `npm run typecheck` (tsc --noEmit, strict) | ✅ 0 errores (con la posición 2 adentro) |
| `npm run test` (Vitest) | ✅ **31/31** — 8 de matriz R2 + 23 de branding (fallbacks R3, E.164 §6, Instagram, CTA R5, completitud) |
| `npm run build` (producción) | ✅ **11 rutas** — las 7 de pos 1 + `/perfil` + 3 API (logo / delete / auth-exit) |
| Smoke prod sin envs (pos 1) | `/` 307→`/setup` · `/auth` 307→`/setup` · `/setup` 200 |
| Smoke runtime real con `.env` (04-nov, pos 1) | login PKCE → `/editor 200` · `/api/config/pricing` **200** · fila derivada en DB (`Kherrera`) · logout visible free |
| **Smoke gating pos 2** (server efímero 7434, sin sesión) | `/perfil` 307→`/auth` · `POST /api/profile/logo` 401 · `POST /api/profile/delete` 401 · `/api/auth/exit` 307→`/auth?cuenta=inhabilitada` · `/auth?cuenta=eliminada` 200 |
| Git | ✅ `3cf09d0` **posición 2** (20 archivos) · `673d2af` docs pos 1 · `c38c4ed` · `e279f45` · `c8edbcf` · `1fa49e0` |

**Pendiente de verificación con sesión real** (necesita 0002 corrida): subida del logo con el
pipeline completo (indicador %, preview, reemplazo webp→png), guardado inline de los 5 campos y
eliminar la cuenta de prueba comprobando el bloqueo neutro del re-login. El smoke restante de
pos 1 (desbloqueo PRO live + realtime) sigue esperando a posiciones 8–10.

---

## 9. Reglas inmutables que el proyecto respeta (resumen de los contratos)

1. **Matriz R2** decide TODO: todo el editor es FREE; exportes/links/white-label/`pro:true` son PRO.
2. **El server manda**: el cliente solo decora candados; limpiar localStorage no concede nada (anti-trampa).
3. **Cada regla vive en UNA spec** (README §5): nombres de eventos/constantes se implementan citándolas (ej. `permissions.ts` — citado por todas).
4. **Números inmutables en su spec de origen**: ej. `D_int ≤ D_ext − 8 mm` (guías), imán ±4° (rotación),
   escaneo 512² α≥128 ≤25ms (escala), threshold L=0.55 (color), ticket 5min (ficha), gracia 5 días (pagos).
5. **Brand congelado por versión de link** (falta llegar) — los cambios de perfil no mutan links vivos.
6. **El precio del plan NUNCA se hardcodea**: vive en `pricing_config` y se imprime desde el backend.
7. **Guías/watermark jamás salen en outputs** ni en el visor de cliente (contrato compartido entre specs).
8. **`location` nunca se imprime** y el **logo original jamás se persiste**: solo el re-encoded
   (≤512 px / thumb 144) sube al bucket privado (spec registro R2/R4).
9. **Sin datos de marca ⇒ neutralidad elegante**: los fallbacks de `resolveBranding()` son la ÚNICA
   implementación (título de plataforma, iniciales, CTA de código `APROBADA-…`) — las pantallas
   consumen la librería, nunca parchean degradaciones propias.

---

## 10. Próxima entrega (cuando se reinicie el trabajo)

**Posición 3 — Catálogo de mates + `projects.state`** (fuente: `spec_tipo_de_mate` §5):

- Primera aparición de las deps de render: `three` + `@react-three/fiber` + `@react-three/drei`
  (regla §3: NO se adelantan deps — se instalan recién cuando su posición llega, que es ahora).
- Catálogo de modelos (selección de tipo de mate) que escribe el snapshot inicial en
  `projects.state` (jsonb, autosave debounce 2 s, last-write-wins — la tabla ya existe desde 0001).
- El placeholder 3D del editor se reemplaza por la primera escena real con la estética premium
  del prototipo como inspiración (sin copiar su código).

Y después: medidas/guías (4) → color (5) → rotación (6) → escala/chorreo (7) → protecciones (8) →
ficha (9) → links/pagos (10).

---

## 11. Orden de lectura sugerido (para volver al proyecto en el futuro)

1. **Este archivo** — entender qué es, en qué punto estamos y por qué.
2. `../simulador_Mates/README.md` — contratos transversales (§5).
3. La spec de la posición que se vaya a trabajar (según `orden_de_implementacion.md`).
4. Código: `lib/permissions.ts` → `middleware.ts` → `app/` → `components/` (orden de dependencia).

> Regla práctica: si dos documentos parecen contradecirse, gana la spec citada como única fuente
> en `../simulador_Mates/README.md §5`. Todos los números comprometidos se cambian ALLÍ y se re-verifican
> los consumidores.
