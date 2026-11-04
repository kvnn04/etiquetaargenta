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

## 2. Dónde estamos: posición 1 de 10 ✅

El orden de construcción (`orden_de_implementacion.md`) manda **perchas primero — caja al final**:

```
1. ✅ ESQUELETO AUTH   ← ESTAMOS ACÁ
2. ⬜ Perfil + resolveBranding()
3-7. ⬜ Editor 3D (catálogo → medidas/guías → color → rotación → escala/chorreo)
8. ⬜ Protección (watermark cocida, bloqueo de rutas DOM, 402 export)
9. ⬜ Ficha técnica export (PNG ≥2160px + PDF A4)
10. ⬜ Links comerciales + Mercado Pago (se cobra recién cuando existe todo)
```

Se eligió empezar por 1 porque **toda la plataforma vive detrás del login** y la matriz de
permisos (R2) es el contrato que las otras 8 specs citan; sin ella no hay a qué engancharse.

**Fuente de verdad de esta entrega:** `../simulador_Mates/spec_autenticacion_y_modelo_freemium.md`
(secundaria para registro: `spec_especificaci_n_tecnica_datos_de_usuario_y_registro.md` §3-R1).

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
| Test unit | Vitest | 4.1.12 | hoy: invariantes de la matriz R2 |
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
├── middleware.ts                  ← gancho del gating de rutas (úsalo: session/supabase/middleware)
├── next.config.mjs                ← alias @/* (webpack + turbopack)
├── tsconfig.json / postcss.config.mjs / vitest.config.ts
├── .env.local.example             ← plantilla de las 3 keys de Supabase (+ futuras MP)
│
├── app/
│   ├── layout.tsx · globals.css   ← shell + tokens de la paleta premium (oro/negro)
│   ├── page.tsx                   ← "/" ⇒ /editor (el middleware envía al visitor a /auth)
│   ├── global.d.ts                ← declara los módulos *.css (TS ≥6)
│   ├── setup/page.tsx             ← página amable cuando faltan env vars (NUNCA un 500 pelado)
│   ├── auth/page.tsx              ← Auth Overlay (con sesión ⇒ /editor)
│   ├── auth/callback/route.ts     ← PKCE: intercambia ?code= por sesión (OAuth/email-verify)
│   ├── (editor)/editor/page.tsx   ← shell del editor: sesión + plan SIEMPRE desde el server
│   └── api/config/pricing/route.ts ← GET precio del plan desde pricing_config (contenido te confirma)
│
├── components/
│   ├── auth/auth-overlay.tsx      ← Google OAuth + email/contraseña + olvidaste tu contraseña
│   ├── editor/editor-shell.tsx    ← top bar + placeholder 3D + panel "Matriz R2" + acciones gated
│   ├── editor/top-bar.tsx         ← badge según plan: DEMO(1/1) / GRACIA(con días) / PRO✓ + menú
│   ├── paywall/paywall-modal.tsx  ← laurel: precio dinámico + beneficios + CTA MP (desactivado: pos 8–10)
│   ├── session/plan-watcher.tsx   ← Realtime: UPDATE en users ⇒ router.refresh() (sin reload)
│   └── ui/{button,input}.tsx      ← primitivas mínimas (cva), patrimonio de shadcn/ui a futuro
│
├── lib/
│   ├── permissions.ts             ← ★ MATRIZ R2 como ÚNICA FUENTE implementada (gate/isLockedFor)
│   ├── cn.ts                      ← clsx + tailwind-merge
│   ├── types/db.ts                ← tipos mínimos de filas (users / pricing_config)
│   └── supabase/
│       ├── middleware.ts          ← updateSession: refresh de token + redirects (visitor⇒/auth, con sesión⇒/editor)
│       ├── server.ts              ← client server-side (cookies)
│       ├── client.ts              ← client de navegador
│       └── service.ts             ← client SERVICE ROLE (saltea RLS — solo API routes) 
│
├── supabase/
│   ├── migrations/
│   │   └── 0001_auth_skeleton.sql     ← users + trigger nombre derivado + projects + pricing_config + RLS + Realtime
│   └── ops/
│       ├── 0901_backfill_user_rows.sql ← reparación: fila faltante en public.users (cuenta nacida pre-migración)
│       └── 0910_base_grants.sql        ← reparación: 'permission denied' (proyectos sin grants automáticos)
│
├── tests/unit/permissions.test.ts ← 8 tests: invariantes de la matriz R2
├── three/README.md                ← qué va a alojar el motor 3D cuando llegue (posiciones 3–7)
└── (node_modules / .next / package-lock…)
```

---

## 5. Lo que quedó implementado (posición 1) — con su criterio QA

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
| 8 | Precio impreso desde el backend (`pricing_config`), nunca hardcodeado | `GET /api/config/pricing` con service-role | ✅ |
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

---

## 7. Estado de configuración externa (checklist operativo)

| Ítem | Estado |
| :--- | :--- |
| `npm install` local | ✅ (106 paquetes) |
| Proyecto Supabase (sa-east-1) | ✅ por el usuario |
| Migración `0001_auth_skeleton.sql` | ✅ (versión sin DROPs; re-ejecutable) |
| Google provider OFF/ON en dashboard | ⬜ configurar si se quiere OAuth (email+contraseña funciona sin esto) |
| `Confirm email = OFF` en dashboard | ⬜ **importante**: si queda ON, el registro "gratis" pide confirmación y contradice la regla de fricción cero |
| Replicación realtime de `public.users` | ⬜ (Dashboard → Database → Replication) |
| `.env.local` con `URL + ANON + SERVICE_ROLE_KEY` | ✅ por el usuario |
| Google Cloud OAuth client (para el provider) | ⬜ |

**Verificación SQL post-migración** (copiable en el SQL Editor):

```sql
select public.derive_base_name('kevin.firma@correo.com');  -- "Kevin Firma"
select public.derive_base_name('12345@correo.com');        -- "MI TALLER"
select * from pricing_config;                              -- pro_monthly_ars · 20000 · ARS
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in ('users','projects');  -- 2 filas rowsecurity=true
```

---

## 8. Verificación técnica de esta entrega (evidencia)

| Check | Resultado |
| :--- | :--- |
| `npm run typecheck` (tsc --noEmit, strict) | ✅ 0 errores |
| `npm run test` (Vitest — matriz R2) | ✅ 8/8 passed |
| `npm run build` (producción) | ✅ 7 rutas + middleware (95 kB) |
| Smoke prod sin envs (server efímero) | `/` 307→`/setup` · `/auth` 307→`/setup` · `/setup` 200 |
| `git init` | ✅ repo inicializado (primer commit pendiente del usuario) |

**Smoke con envs** (pendiente de probar por el usuario): registrar una cuenta y verificar que
`users` crece con el nombre derivado y `plan=free`, y que el editor muestra la fila de "Matriz R2".

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

---

## 10. Próxima entrega (cuando se reinicie el trabajo)

**Posición 2 — Perfil + `resolveBranding()`** (`spec_especificaci_n_tecnica_datos_de_usuario_y_registro.md`):

- Panel de Perfil: logo (pipeline webp ≤512px + thumb 144), nombre comercial, WhatsApp E.164
  (`+54` default), Instagram, ubicación (interna, nunca impresa).
- Indicador "Perfil al X%" = 5 campos × 20 %.
- **Librería única de fallbacks** (`resolveBranding(profile)`) — la van a consumir ficha/visor/CTA
  desde ahora, para no parchear después (razón por la que va ANTES del editor).
- Zona de peligro: eliminación de cuenta con borrado en cascada + 30 días restauración.

Y después, el motor del editor (posiciones 3–7) — ver `three/README.md` para el plan de archivos.

---

## 11. Orden de lectura sugerido (para volver al proyecto en el futuro)

1. **Este archivo** — entender qué es, en qué punto estamos y por qué.
2. `../simulador_Mates/README.md` — contratos transversales (§5).
3. La spec de la posición que se vaya a trabajar (según `orden_de_implementacion.md`).
4. Código: `lib/permissions.ts` → `middleware.ts` → `app/` → `components/` (orden de dependencia).

> Regla práctica: si dos documentos parecen contradecirse, gana la spec citada como única fuente
> en `documentación/README.md §5`. Todos los números comprometidos se cambian ALLÍ y se re-verifican
> los consumidores.
