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

## 2. Dónde estamos: posición 5 de 10 ✅

El orden de construcción (`orden_de_implementacion.md`) manda **perchas primero — caja al final**:

```
1. ✅ ESQUELETO AUTH
2. ✅ Perfil + resolveBranding()
3. ✅ Catálogo de mates + escena 3D
4. ✅ Medidas de virola (3 mallas) + guías coplanares + cascada + auto-giro
5. ✅ Editor 3D: color PBR + quemado adaptativo (cuerpo/virola #HEX)   ← ESTAMOS ACÁ
6-7. ⬜ Editor 3D (rotación → escala/chorreo)
8. ⬜ Protección (watermark cocida, bloqueo de rutas DOM, 402 export)
9. ⬜ Ficha técnica export (PNG ≥2160px + PDF A4)
10. ⬜ Links comerciales + Mercado Pago (se cobra recién cuando existe todo)
```

La posición 4 entregó la **edición milimétrica de virola**, la **anatomía formal en 3 mallas**
(`virolaTopMesh` corona superior anular plana para grabado/guías, `virolaOuterWallMesh` faldón
exterior liso anti-fuga y `virolaInnerWallMesh` pared interior de boca), las **guías de simetría
coplanares** en la cara superior ($R_{int}$, $R_{ext}$, $R_{\text{centro}}$ y ejes radiales 12h/6h con ticks),
la **cascada única** `virola.dimensionsChanged` (<100 ms), los **sliders con rangos dinámicos**
sin puntos muertos en la tarjeta `DimensionsCard`, y el **auto-giro de 0.75 RPM** con pausa por
interacción (OrbitControls) y botón de reanudación `AutoGiroBar`.

La posición 5 creció sobre esa corona con el **sistema de color inteligente**
(`spec_seleccion_de_color.md`): el material PBR del cuerpo y de las 3 mallas de virola sale de
una **tabla canónica única** (`lib/color.ts` — presets Algarrobo/Calabaza/Cuero Negro y
Alpaca/Acero/Bronce) con **color libre #HEX** por zona (virola anodizada ⇒ metalness 0.10 /
roughness 0.45; cuerpo libre ⇒ 0.00/0.82), **colores recientes** (máx 6, por zona, dedup) y
**exclusividad mutua** preset ⇄ hex (R3). La regla de **quemado adaptativo** del grabado (R4)
queda implementada y expuesta: luminancia $L = 0.2126R + 0.7152G + 0.0722B$ con threshold
**0.55** — fondo claro ⇒ quemado oscuro `#2B2118@0.88`, fondo oscuro ⇒ plateado `#C9CCCF@0.92`
(su consumidor natural es la capa de diseño de la posición 6). UI como **tarjeta "Materiales y
Acabados"**, tercera del panel — decisión del titular: tarjetas apiladas, sin pestañas.

La posición 3 reemplazó el placeholder 3D por la **primera escena real**: el catálogo de
productos (Camionero ⇄ Imperial) como **registro central solo-datos** (`lib/catalog.ts`), el
motor de torno (`three/lathe-builder.ts`) con el **contrato de costura UV** anclado para las
posiciones 4–6, el autosave en `projects.state` (debounce 2 s, last-write-wins) con borrador
local si se corta la red, y la tarjeta **"Configuración del Producto"** como primera sección
del panel (§4 de la spec). **Sin migración nueva**: la tabla `projects` ya existía desde `0001`
y el autosave la consume tal cual.

La posición 2 entregó el **Panel de Perfil** (`/perfil`), la **librería única de branding**
(`resolveBranding()` — fallbacks canónicos que consumirán ficha/visor/CTA desde las posiciones
6–10) y la **Zona de peligro** (eliminar cuenta, R8). Sus migraciones ya están aplicadas en el
proyecto real (`0002` y la `0003` que añadió la posición 3 — checklist §7).

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
| Runtime UI | React | 19.1.10 | base de R3F v9 (activo desde la posición 3) |
| Lenguaje | TypeScript strict | **6.x** | TS 7 nativo aún NO soportado por Next 15.5 |
| Estilos | Tailwind CSS | 4.3.4 | CSS-first (`@theme inline`), sin `tailwind.config` |
| Backend / Auth / DB | Supabase (`@supabase/supabase-js` + `@supabase/ssr`) | 2.119 / 0.12 | Postgres + RLS + Auth + Realtime |
| Iconos | lucide-react | latest | |
| Test unit | Vitest | 4.1.12 | hoy: 107 tests (matriz R2 + branding + catálogo + virola/geometría pos 4 + color pos 5) |
| 3D | `three` 0.187 + `@react-three/fiber` 9.8 + drei 10.7 | instalados en la posición 3 | LatheGeometry desde el catálogo; escena via `dynamic` con `ssr: false` |
| Estado cliente | zustand | 5.0 | store del editor = snapshot de `projects.state` |
| Se instalan SOLO al llegar su posición | `zod`, `pdf-lib`, `sharp`, `mercadopago`, Playwright | — | regla vigente: no adelantar deps |

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
│   ├── editor/editor-shell.tsx    ← top bar + escena 3D (dynamic ssr:false) + restore + panel gated
│   ├── editor/top-bar.tsx         ← badge por plan + logo/iniciales + ícono Perfil (todas las plans)
│   ├── paywall/paywall-modal.tsx  ← laurel: precio dinámico + beneficios + CTA MP (desactivado: pos 8–10)
│   ├── session/plan-watcher.tsx   ← Realtime: UPDATE en users ⇒ router.refresh() (sin reload)
│   ├── studio/studio-scene.tsx    ← ESCENA 3D pos 4–5: cuerpo lathe + virola 3 mallas PBR + guías coplanares + auto-giro
│   ├── studio/product-selector.tsx ← radio-cards (radiogroup) con siluetas SVG derivadas del catálogo
│   ├── studio/dimensions-card.tsx ← TARJETA MEDIDAS pos 4: D_ext/D_int + steppers + sliders dinámicos + métricas + guías
│   ├── studio/color-picker-card.tsx ← TARJETA COLOR pos 5: presets PBR + #HEX (dot nativo) + recientes + quemado
│   ├── studio/auto-giro-bar.tsx   ← BARRA AUTO-GIRO pos 4: 0.75 RPM + botón Girar/Pausar + pausa por interacción
│   └── ui/{button,input}.tsx      ← primitivas mínimas (cva), patrimonio de shadcn/ui a futuro
│
├── lib/
│   ├── permissions.ts             ← ★ MATRIZ R2 como ÚNICA FUENTE implementada (gate/isLockedFor)
│   ├── branding.ts                ← ★ resolveBranding() + approvalCode() + normalizadores (R3/R5)
│   ├── catalog.ts                 ← ★ REGISTRO CENTRAL DE PRODUCTOS (R1) + validación §6 + fallback R8
│   ├── virola.ts                  ← ★ MEDIDAS VIROLA: clamps R1, rangos dinámicos, métricas R2, triada guías R6
│   ├── virola/cascade.ts          ← ★ CASCADA ÚNICA virola.dimensionsChanged (<100 ms, bus de eventos)
│   ├── color.ts                   ← ★ COLOR INTELIGENTE pos 5: tabla PBR R1 + exclusividad/recientes R3 + quemado R4 (L 0.55)
│   ├── store/editor.ts            ← zustand: estado del editor = snapshot de projects.state (color: pos 5)
│   ├── projects/persistence.ts    ← restore (last-write-wins) + upsert + borrador local con timestamp
│   ├── projects/use-autosave.ts   ← debounce 2 s + banner offline + backoff de reconexión (§5/§6)
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
│   │   └── 0002_profile_fields.sql    ← columnas de branding + CHECKs + deleted_at (aplicada 04-nov)
│   │   └── 0003_projects_owner_default.sql ← default auth.uid() en projects (aplicada 04-nov)
│   └── ops/
│       ├── 0901_backfill_user_rows.sql ← reparación: fila faltante en public.users (cuenta nacida pre-migración)
│       ├── 0910_base_grants.sql        ← grants ampliados users/projects/pricing (aplicada 04-nov)
│       └── 0920_purge_deleted_accounts.sql ← R8: restauración manual + purga a 30 días (soporte / pg_cron)
│
├── tests/
│   ├── unit/permissions.test.ts   ← 8 tests: invariantes de la matriz R2
│   ├── unit/branding.test.ts      ← 23 tests: fallbacks, CTA R5, E.164, Instagram, completitud
│   ├── unit/catalog.test.ts       ← 13 tests: QA1 matemático, labio anti-fuga R4, R8, corrupción §6
│   ├── unit/color.test.ts         ← 32 tests: tabla PBR R1, exclusividad/recientes R3, quemado R4 (luminancia), descriptores R5
│   └── unit/virola.test.ts        ← 31 tests: R1 clamps/rangos dinámicos, R2 métricas, R3 cascada <100ms, R4/R5 guías coplanares, R6 triada, R7 auto-giro
├── three/README.md                ← índice del motor 3D + contrato de costura UV (posiciones 3–7)
├── three/visual-skeleton.ts       ← constantes visuales pos 4 + LATHE_SEAM_PHI_START
├── three/guides.ts                ← GUÍAS DE SIMETRÍA pos 4: coplanares en corona superior plana (círculos + ejes radiales + ticks)
├── three/lathe-builder.ts         ← CUERPO + VIROLA 3 MALLAS: corona superior plana + faldón exterior + pared interior boca
└── (node_modules / .next / package-lock…)
```

---

## 5. Lo que quedó implementado (posiciones 1–3) — con su criterio QA

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

### Posición 3 — Catálogo + escena 3D + `projects.state` (según `spec_tipo_de_mate.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Catálogo = registro central solo-datos: un producto nuevo es UNA entrada, el motor no ramifica por modelo | `lib/catalog.ts` con Camionero/Imperial (coordenadas verbatim de la spec); componente y escena consumen el array | ✅ |
| R2 | Perfil de puntos `(x, y)`: la boca escala con la D_int vigente (x=1.00 ⇒ R_boca = D_int/2) | el builder del torno multiplica `x · D_int/2` y el labio hereda ese radio | ✅ |
| R3 | Aislamiento de la virola (inviolable): el swap afecta SOLO la malla del cuerpo — sin morph, sin parpadeo de iluminación | geometría memoizada por `(producto, D_int)`; la banda, las luces y la órbita no se re-inicializan | ✅ |
| R4 | Anclaje boca-cuerpo anti-fuga: `sealOverlapMm = 1.0` oculto bajo la virola para D_int 50–150 | el perfil termina en un labio que sube 1 mm sobre la costura; la banda lo tapa | ✅ |
| R5 | Cada producto define su altura y contorno propios, sin reglas globales | `totalHeightMm`/`points` leen del JSON; la cámara encuadra por producto | ✅ |
| R7 | Contrato de salida: `mateModel` guarda el id (`"camionero"` \| `"imperial"`) | clave del store y de `projects.state` (la Ficha solicitará este contrato en pos 9) | ✅ |
| R8 | Enlaces o estados con id desconocido ⇒ fallback `camionero`, sin abortar la carga | `resolveMateModel()` + `normalizeState()` | ✅ |
| QA1 | Fidelidad distinguible: panza Imperial ≥ 1.25× el radio del Camionero a media altura | test matemático: Imperial 1.30·R_boca (a 55 mm) vs 1.02·R_boca del Camionero ⇒ ratio ≈ 1.27 ≥ 1.25 | ✅ |
| QA2 | Swap < 300 ms, sin resetear órbita ni iluminación | swap instantáneo de geometría + refit de cámara SOLO si excede encuadre (~300 ms, easeOut) | ⬜ visual |
| QA3 | Al reabrir se restaura el producto activo | restore del proyecto más reciente con prioridad del borrador local más nuevo | ✅ con sesión real (04-nov) · la mitad de ficha/links: pos 9–10 |
| QA4 | Escalabilidad solo-datos: un 3.er producto funciona con su entrada JSON y 0 líneas extra | el test agrega un producto más a la validación; selector y siluetas derivan del mismo array | ✅ (estructural) |
| §6 | Entrada corrupta jamás deja la escena vacía | `validateCatalog()` descarta (<3 puntos, alturas no positivas, ids duplicados) con aviso en consola | ✅ |
| §6 | Corte de internet durante el autosave no pierde trabajo | borrador local con timestamp + banner en pantalla + backoff 1s→30s + flush al reconectar | ✅ código |

### Posición 4 — Medidas de la virola + anatomía 3 mallas + guías coplanares + auto-giro (según `spec_tecnica_geometrica_guias_y_rotacion_360.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Anatomía de 3 mallas: corona superior anular plana (grabado/guías) + faldón exterior liso + pared interior boca | `buildVirolaTopGeometry`, `buildVirolaOuterWallGeometry`, `buildVirolaInnerWallGeometry` en `three/lathe-builder.ts` | ✅ (tests + build) |
| R1 | Restricciones duras D_ext [70..180], D_int [50..150], paso 0.5 y W ≥ 4.0 mm con rangos dinámicos | `lib/virola.ts` (`reconcileDiameters`, `intRangeFor`, `extRangeFor`) con clamps sin puntos muertos y aviso inline | ✅ (testeado) |
| R2 | Métricas auto-calculadas: D_centro y W_banda (1 decimal, mm) | `virolaMetrics()` en `lib/virola.ts` | ✅ |
| R3 | Cascada única `virola.dimensionsChanged` (<100 ms): valida → métricas → redraw guías → re-anclaje cuerpo → desborde | `runDimensionsCascade()` en `lib/virola/cascade.ts` con bus de suscriptores para pos 7 | ✅ (QA2: <0.1 ms/corrida) |
| R4 | Guías coplanares en corona superior plana (plano X-Z con offset Y + ε) ancladas al UV 0° | `three/guides.ts` (`guideCirclePoints`, `guideRadialAxisPoints`, `guideRadialAxisTicks`) | ✅ |
| R5 | Catálogo visual de guías: bordes (4-3 #4FC3F7), centro (6-4 #FFC84A), ejes radiales 12h/6h con ticks (#FF7043) | `GuidesLayer` en `components/studio/studio-scene.tsx` con doble trazo oscuro bajo color | ✅ |
| R6 | Persistencia del estado de guías (`guidesState: { bordes, centro, ejes }`) | store del editor + `projects.state` (default true×3, normalize tolerante) | ✅ |
| R7 | Auto-giro del editor a 0.75 RPM con pausa por interacción (OrbitControls) y botón de reanudación | `AutoSpin` en escena + `components/studio/auto-giro-bar.tsx` | ✅ |
| §4 | Tarjeta "Medidas de la Virola" con inputs, steppers ±0.5, sliders dinámicos, métricas y checkboxes | `components/studio/dimensions-card.tsx` | ✅ |
| §5 | Selector memoizado en store para prevenir bucles de re-render en React 19 (`getSnapshot`) | selectores primitivos + derivación `useMemo` en `studio-scene.tsx` | ✅ |

**Constantes con origen anotado** (`three/visual-skeleton.ts`): los defaults `D_ext = 123.0` /
`D_int = 95.0 mm` salen de la spec geométrica §2 ("proyecto nuevo arranca con esos valores"), y
el **contrato de costura UV** `LATHE_SEAM_PHI_START = Math.PI` es el ancla compartida de guías
(pos 4) y rotación (pos 6). El resto (altura de banda 24 mm, cubierta 3 mm bajo costura, pared
3 mm) son **constantes provisionales del esqueleto visual**: se re-fijan citando la spec cuando
lleguen las posiciones 4–5, hoy ninguna es contrato.

**Desvío consciente documentado**: la spec §6 pide borrador local *"cifrado"*; se guarda **sin
cifrar** (es la copia del propio estado del editor, sin secretos, y localStorage del navegador
ya limita el acceso al mismo origen). Si el titular quiere cifrarlo, va junto con la capa de
protección de la posición 8.

### Posición 5 — Color PBR + quemado adaptativo (según `spec_seleccion_de_color.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Tabla PBR canónica única: presets de cuerpo y virola + valores libres anotados (anodizado 0.10/0.45, cuerpo libre 0.00/0.82) | `lib/color.ts` (`METAL_PRESETS`, `BODY_PRESETS`, `ANODIZED_VIROLA_PBR`, `FREE_BODY_PBR`) | ✅ (32 tests) |
| R2 | Cobertura integral de virola: el color tiñe corona + faldón + pared interior sin tocar guías/cuerpo | un único material memoizado en `VirolaGroup` (`resolveVirolaPbr`) compartido por las 3 mallas; overlays intactos | ✅ |
| R3 | Exclusividad mutua preset ⇄ color libre + historial de recientes (máx 6, dedup, por zona) | `setBodyPreset/setMetalPreset` limpian el hex; `addRecentColor` por zona | ✅ (testeado) |
| R4 | Quemado adaptativo del grabado: preset metálico ⇒ oscuro; color libre ⇒ L ≥ 0.55 oscuro #2B2118@0.88 · L < 0.55 plateado #C9CCCF@0.92 | `adaptiveLaserBurn()` (luminancia BT.709, threshold 0.55) en `lib/color.ts` | ✅ (QA tabla de casos) |
| R5 | Descriptor canónico para Ficha/Cotización | `formatColorDescriptor()` (ej. `"Virola: #2A2A2A · Anodizado Personalizado"`) | ✅ (su CONSUMO: pos 9) |
| R7 | Persistencia del color (bodyPreset/metalPreset/bodyColor/virolaColor/recentColors) | 5 claves nuevas del snapshot + `normalizeState` tolerante (legacy `topFaceColor` ⇒ `virolaColor`) | ✅ |
| §4 | Tarjeta "Materiales y Acabados" (tercera del panel — decisión del titular: sin pestañas) | `components/studio/color-picker-card.tsx` (dot nativo + swatches + recientes) | ✅ |

**Nota de la entrega (05-nov):** el quemado R4 todavía **no** se dibuja sobre la escena — es el
tono del GRABADO y su consumidor natural es la capa de diseño de la posición 6 (que lo leerá de
`adaptiveLaserBurn()`); pos 5 solo fija y testa la regla.

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

El **editor** suma su recorrido de datos desde la posición 3 (spec tipo de mate §5):

```
/editor: al abrir restaura el proyecto más reciente (RLS own_projects, last-write-wins)
│
├─ borrador local más nuevo que el backend ⇒ manda él + el autosave lo lleva a la base
└─ escena 3D: elegir otro producto reconstruye SOLO la geometría del cuerpo
     autosave: cambio de estado (dirty) ⇒ debounce 2 s ⇒ upsert idempotente en projects
     └─ fallo de red ⇒ borrador local + banner "quedó en este dispositivo"
        + reintentos con backoff (1 s → 30 s) y flush al volver la conexión
```

---

## 7. Estado de configuración externa (checklist operativo)

| Ítem | Estado |
| :--- | :--- |
| `npm install` local | ✅ 168 paquetes (las deps 3D de la posición 3 ya están adentro) |
| Proyecto Supabase (sa-east-1) | ✅ por el usuario |
| Migración `0001_auth_skeleton.sql` | ✅ ejecutada en el proyecto real (idempotente, sin DROP; los grants también quedaron embedidos en el archivo) |
| Migración `0003_projects_owner_default.sql` | ✅ aplicada 04-nov — `projects.user_id` nace con `default auth.uid()`; el autosave ya no logea `new row violates row-level security policy` (el INSERT del editor cargó la fila con la sesión vigente) |
| Migración `0002_profile_fields.sql` | ✅ aplicada 04-nov — confirmada por el QA del panel: los 5 campos viven en columnas de esta migración y respondieron tras ampliar los grants |
| Bucket Storage `branding` | ➖ no requiere acción: se crea SOLO (lazy) en la primera subida de logo, con service role (privado — las URLs a las vistas se firman 1 h) |
| Grants base (users / projects / pricing) | ✅ `ops/0910_base_grants.sql` ampliado y re-corrido 04-nov: `update` de users para `authenticated` y `select, update` para `service_role` (el proyecto del usuario NO aplica GRANT automáticos) |
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
| `[projects] save: "new row violates row-level security policy"` al autosave (QA pos 3, 04-nov) | `projects.user_id` sin `default auth.uid()` (migración 0001): el INSERT del autosave llegaba con `user_id = NULL` y el `with check` de `own_projects` lo rechazaba | migración `0003_projects_owner_default.sql` — aditiva (solo SET DEFAULT); en fresh setups el patrón ya arranca acá |
| `/perfil`: los 4 campos morían con `permission denied for table users` + el logo con "El Storage estaba caído" (QA pos 2, 04-nov) | los grants de `ops/0910` habían quedado cortos: `authenticated` solo tenía `select` de users y `service_role` nada — GRANT se evalúa ANTES de RLS, así que ni el update del panel ni el de `logo_url` del server llegaban a la política; además el catch de la ruta del logo disfrazaba el fallo de DB como 503 "Storage caído" | `ops/0910` ampliado (sumativo): `update` para `authenticated` + `select, update` para `service_role` en users; la ruta del logo ahora distingue Storage (503) de persistencia de la fila (500 `GUARDADO_FALLIDO`) con mensajes honestos en el panel — **confirmado 04-nov: tras re-correr el ops, campos y logo responden** |

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
| `npm run typecheck` (tsc --noEmit, strict) | ✅ **0 errores** (con las posiciones 4–5 adentro) |
| `npm run test` (Vitest) | ✅ **107/107** — 8 de matriz R2 + 23 de branding + 13 de catálogo + 31 de virola/guías/geometría pos 4 + **32 de color pos 5** |
| `npm run build` (producción) | ✅ **11 rutas** — `/editor` 17 kB; el motor 3D viaja en su propio chunk (`dynamic` `ssr:false`, nunca dentro del HTML inicial) |
| Smoke prod sin envs (pos 1) | `/` 307→`/setup` · `/auth` 307→`/setup` · `/setup` 200 |
| Smoke runtime real con `.env` (04-nov, pos 1) | login PKCE → `/editor 200` · `/api/config/pricing` **200** · fila derivada en DB (`Kherrera`) · logout visible free |
| **Smoke gating pos 2** (server efímero 7434, sin sesión) | `/perfil` 307→`/auth` · `POST /api/profile/logo` 401 · `POST /api/profile/delete` 401 · `/api/auth/exit` 307→`/auth?cuenta=inhabilitada` · `/auth?cuenta=eliminada` 200 |
| **Smoke gating pos 3** (server efímero 7435, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 — el guard de ruta sobrevive al nuevo canvas |
| **Smoke gating pos 5** (server efímero 7436, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 · `/api/config/pricing` 200 — el guard y el precio sobreviven al color |
| **QA Posición 4** (05-nov) | Corona superior plana con normales +Y ✅ · guías concéntricas coplanares en X-Z ✅ · cascada <100 ms ✅ · sliders dinámicos R1 ✅ · auto-giro 0.75 RPM + pausa/play ✅ · fix de loop React 19 memoizado ✅ |
| **QA Posición 5** (05-nov) | Tabla PBR canónica ✅ · anodizado 0.10/0.45 y cuerpo libre 0.00/0.82 ✅ · exclusividad preset⇄hex ✅ · recientes máx 6 ✅ · quemado L 0.55 con ambas ramas ✅ |
| Git | ✅ `940e69c` **posición 5** (color) · `feca766` **posición 4** (3 mallas + guías; extendida) · `e6ac05d` docs QA 04-nov · `9156361` docs pos 3 · `56483ef` grants 0910 + ruta logo honesta · `8a4329d` fix 0003 RLS autosave · `f54e359` fix R3/QA2 pos 3 · `db31c08` **posición 3** (12 archivos, 1.928 insertiones) · `e6ead5a` docs pos 2 · `3cf09d0` **posición 2** · `673d2af` docs pos 1 · `c38c4ed` · `e279f45` · `c8edbcf` · `1fa49e0` |

**QA de sesión real (04-nov, con el proyecto real de Supabase):** logo con pipeline completo ✅
· los 5 campos del panel ✅ (ambos flujos tras ampliar los grants de `ops/0910`) · autosave en
`projects.state` ✅ tras la 0003 · restore al reabrir ✅. Queda a tu ritmo: eliminar la cuenta
de prueba (bloqueo neutro del re-login, R8) y la pasada fina de la escena (swap/refit de
cámara, unión metal-cuerpo y banner offline con la red cortada). El smoke restante de pos 1
(desbloqueo PRO live + realtime) sigue esperando a posiciones 8–10.

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

**Posición 6 — Rotación del diseño SVG/PNG** (fuente: `spec_rotacion_archivo_svg_png.md`):

- **Marco canónico (R1):** 0° = eje de nacimiento de la costura UV de la chapa plana (pivote en el
  **centro del carril**, anclado a `LATHE_SEAM_PHI_START`); presets **0° Frente · 90° Der ·
  180° Dorso · 270° Izq** — un solo marco para TODOS los productos del catálogo.
- **Orden de composite (R2):** escala y espejo (pos 7) → **rotación** actúa ÚLTIMA: gira exactamente
  la imagen que el usuario ve en pantalla (incluido el espejo); cambiar el orden queda prohibido.
- **Representación única (R3):** escalar en [0°, 360°) con paso 0.5° — 370°⇒10°, −90°⇒270°,
  45.25°⇒45.5°; jamás −180°/180° bipolar en UI, ficha ni payload.
- **Imán configurable (R4):** checkbox ON por defecto, atracción ±4° al arrastrar cerca de los
  presets; presets fijan exacto siempre; botón de reset vuelve a 0° conservando escala/espejo/imán.
- **Re-chequeo de desborde (R6):** cada ángulo re-evalúa el trazado contra R_ext/R_int con banner
  inmediato incluso arrastrando — motor compartido con pos 7 (el gancho queda preparado).
- **Persistencia (R7):** `design.rotation` en `projects.state`; el imán es **solo de dispositivo**
  (localStorage, nunca jsonb — §5); legacy sin rotation ⇒ 0° (R8).
- **Re-muestreo (R8):** vivo sobre canvas 1024²; la rotación es **FREE (sin candado)**, no reconstruye
  la virola ni re-inicializa luces, y respeta el tono de quemado R4 de pos 5; guías estáticas y
  auto-giro ajenos — ninguno pausa ni resetea al otro.

Y después: escala/chorreo (7) → protecciones (8) → ficha (9) → links/pagos (10).

---

## 11. Orden de lectura sugerido (para volver al proyecto en el futuro)

1. **Este archivo** — entender qué es, en qué punto estamos y por qué.
2. `../simulador_Mates/README.md` — contratos transversales (§5).
3. La spec de la posición que se vaya a trabajar (según `orden_de_implementacion.md`).
4. Código: `lib/permissions.ts` → `middleware.ts` → `app/` → `components/` (orden de dependencia).

> Regla práctica: si dos documentos parecen contradecirse, gana la spec citada como única fuente
> en `../simulador_Mates/README.md §5`. Todos los números comprometidos se cambian ALLÍ y se re-verifican
> los consumidores.
