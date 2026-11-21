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

## 2. Dónde estamos: posición 10B de 10 ✅ (QA en vivo corrido — 07-nov)

El orden de construcción (`orden_de_implementacion.md`) manda **perchas primero — caja al final**:

```
1. ✅ ESQUELETO AUTH
2. ✅ Perfil + resolveBranding()
3. ✅ Catálogo de mates + escena 3D
4. ✅ Medidas de virola (3 mallas) + guías coplanares + cascada + auto-giro
5. ✅ Editor 3D: color PBR + quemado adaptativo (cuerpo/virola #HEX)
6. ✅ Editor 3D: rotación del diseño SVG/PNG (imán ±4°, presets)
7. ✅ Editor 3D: escala fina 70–110 % + motor de desborde "chorreo" + espejo (botón Auto retirado por decisión del titular 05-nov)
8. ✅ Protección FREE: watermark cocida al render + bloqueo de rutas DOM + 402 en la API de export
9. ✅ Ficha técnica: snapshot inmutable + grilla de 9 tarjetas + PNG HD + PDF A4 + Foto HD + registro QA
10. ✅ 10A — Enlace Comercial compartible + Modo Cliente /v/[linkId]
11. ✅ 10B — Mercado Pago: caja + webhook + dunning ← ESTAMOS ACÁ (07-nov: QA en vivo del
    sandbox completo — evidencias y desviaciones del modo TEST de MP en §8; iteración visual
    del titular pendiente: reload /perfil, inbox, panel MP y línea SQL del precio)
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

La posición 6 graba el diseño en esa corona: la **rotación angular 360° del grabado SVG/PNG**
(`spec_rotacion_archivo_svg_png.md`). Desde **Cargar Archivo / Edición del Vector** (SVG/PNG
rasterizado en cliente al lienzo de trabajo 1024² de R8) el diseño gira con el **slider de
paso 0.5° en $[0°, 360°)$** (R3: normalización por módulo — $370°⇒10°$, $-90°⇒270°$,
$45.25°⇒45.5°$), el **campo numérico sincrónico** (texto/vacío restaura el último válido), los
**4 presets exactos** ($0°$ Frente · $90°$ Der · $180°$ Dorso · $270°$ Izq) y el **imán
configurable ±4°** (R4, checkbox ON por defecto que vive SOLO en el dispositivo, igual que el
auto-giro — nunca en el jsonb). El ángulo **jamás reconstruye virola ni re-inicializa luces**:
solo re-composita la CanvasTexture sobre `virolaTopMesh` (UV polar ya anclada en pos 4 a
`LATHE_SEAM_PHI_START`), tinteada con el **tono de quemado adaptativo R4 de la posición 5**
($L\,0.55$: quemado oscuro sobre metales claros, plateado destapado sobre oscuros). La rotación
es **FREE (sin candado)**, deja estáticas las guías y respeta al auto-giro como subsistema
ajeno, y `design.rotation` viaja en `projects.state` (legacy sin rotation ⇒ 0°, R8). El
**archivo del diseño es de sesión**: se persiste SOLO la rotación — el ciclo de vida del
archivo llega con las variantes (pos 7) y los links (pos 10).

La posición 7 cierra el editor con la **escala fina y el motor único de desborde "chorreo"**
(`spec_escala_y_alerta_de_desborde.md`) y entrega el **espejo** que la rotación (R2 pos 6)
había aplazado para acá. El **100 % queda anclado en la CARGA del archivo** (R1): el
contain-fit de pos 6 ya dimensiona el trazado para que su envolvente toque el anillo con el
D_ext vigente; ese tamaño se **congela** en el asset (`DesignAsset.baseSideMm`) y el rango
**70–110 % con paso 0.5 %** opera SOLO como multiplicador — editar D_ext/D_int después NO
re-escala el diseño, apenas re-chequea (el % tiene siempre el mismo significado). El
**motor** vive en `lib/overflow.ts`: al cargar se mide la **envolvente radial de tinta**
(máscara alfa 512², α ≥ 128 — R4) y todo el chequeo se reduce a dos escalares en mm contra
R_ext/R_int con **tolerancia 0 estricta** (tocar no es desbordar); la evaluación es O(1) por
estado y re-dispara SOLO por escala, diámetros y carga de diseño — **girar y espejar jamás
re-chequean** (invariancia polar R3, isometrías con pivote fijo). La tarjeta suma la sección
C **"Tamaño / Escala del Grabado"** (slider + campo WYSIWYG y presets 85/90/100 — el botón
**Auto** de la spec R7 quedó **RETIRADO por decisión del titular** (05-nov): la mayor escala
segura la elige el tallerista a ojo con el slider y el banner; `largestSafeScalePct` sigue
testeada en `lib/overflow` por si ficha/variantes la reusan), el **banner** con la redacción
EXACTA de R5 (ámbar → rojo si el desvío ≥ 2 mm, nota visual anotada) y las guías afectadas
con **pulso rojo de 500 ms** (`#FF3B30`, overlay en la escena). Si el raster del chequeo
falla, el chequeo cae a modo envolvente conservador con aviso "Detección aproximada" (§6).
Todo **FREE** (escala, espejo, banner); el **margen JAMÁS se persiste**: es derivable
y se recalcula al abrir (R8: `design.scale`/`mirror` sí persisten; legacy ⇒ 100 % / OFF).

Post-entrega de la 7 (mismo 05-nov, misma decisión): la tarjeta retiró el botón Auto y se
corrigió la **pérdida de nitidez del SVG al subirlo a la virola** — el vector se rasteriza
SIEMPRE a la resolución final vía **envoltorio de 1024²** (sin él, un SVG con width/height
chicos — o sin ellos: el estándar cae a 300×150 — nacía rasterizado en su tamaño intrínseco
y el estirado del bitmap borroso era la pérdida clásica); **sin refuerzo de alfa ×1.8 en SVG**
(conserva su anti-aliasing nativo; el refuerzo de trazos finos queda SOLO para PNG) y la
CanvasTexture del grabado lleva **anisotropía máxima de la GPU** (la virola vista de perfil
deja de desenfocarse por mipmap en ángulos rasantes). Canvas de trabajo intacto: 1024² (R8).

La posición 8 enciende la **protección honesta** del bloque SaaS (segunda pasada por la spec
de auth; fuente única `spec_autenticacion_y_modelo_freemium.md` §3-R4 + QA-3): **watermark
"MODO DEMO · Suscribite para descargar en HD" COCIDA AL RENDER** — banda diagonal
semitransparente centrada pintada en el propio canvas WebGL con una segunda pasada
ortográfica (autoClear off + clearDepth tras el pase principal, prioridad 1 en el loop) —
solo plan `free`: `pro`/`pro_grace` ven el render limpio (`gate('render.no-watermark')`,
coherente con R7: en gracia castiga el banner, no el sello). **Bloqueo de rutas DOM** en
demo (`contextmenu` + arrastre sobre el lienzo, `select-none`; cero blob URLs expuestos —
el asset vive como canvas en memoria de sesión) y **`402` en la API de export**:
`POST /api/exports/ticket` valida sesión por cookies y lee el plan AUTORITATIVO de `users`
vía service-role (el claim del JWT es cache; fail-closed: sin fila ⇒ `free`), `free` ⇒ 402
`{error:'PAYWALL_REQUIRED'}` que abre el modal Paywall (§6: jamás error crudo),
`pro`/`pro_grace` ⇒ ticket **HMAC-SHA256 con vigencia EXACTA de 5 min** ligado al hash del
snapshot (`v1.<payload>.<firma>`, b64url — forma de `spec_detalle_del_modelo_en_ficha`
R7 la que ficha/pos 9 consume; el motor gráfico se enchufa sin tocar la ruta). Badge del
demo **reactivo** (R3): `(0/1)` hasta el primer diseño ⇒ `(1/1)` — reemplazo libre dentro
del slot (el contador cuenta el asset de sesión; la cuota real 1/1 con conteo server-side
llega con el ciclo de vida de archivos, pos 10). Los bloques R3 de "2do proyecto" y
"Reiniciar proyecto" quedan documentados pero SIN UI creada (decisión del titular 05-nov;
cuando existan se conectan al `gate()` ya montado). El límite declarado se respeta: las
capturas del SO no se bloquean — el sello cocido las rinde inservibles limpias.

La posición 9 entrega el **motor gráfico de salida** (fuente única `spec_detalle_del_modelo_en_-
fica.md`): el **modal `#quoteModal`** — "Ficha Técnica (PNG / PDF)" del panel — captura al abrir un
**snapshot inmutable** (`lib/quote/snapshot.ts`: todo derivado del estado vivo, transitorio,
jamás en `projects.state`) con badge **"Actualizado a las HH:MM"** + botón **Actualizar** que
re-captura (R1). El panel imprime la **grilla React de las 9 tarjetas** — Producto (Modelo /
D_ext / D_int / **banda auto W=(Dext−Dint)/2**), Grabado (Escala / Rotación / **Margen** via
`marginSheetLine()` pos 7) y Acabados (Virola / Cuerpo) — con los **formatos EXACTOS R2**
(`123.0 mm` SIEMPRE 1 decimal; `92%`/`92.5%`; `45°`/`45.5°`; faltante ⇒ `—`) y los
**descriptores fijos R3** (`#2A2A2A · Anodizado Personalizado`, `#E6C48E · Color Libre`,
presets por su nombre — jamás auto-nombres). Sin archivo en el slot de sesión las 3 tarjetas de
Grabado muestran "Sin diseño cargado" y Producto/Acabados siguen imprimiendo (decisión del
titular). Las **observaciones** (R5, máx 280 + contador) viven en la shell (sesión):
sobreviven a cerrar/reabrir el modal, un chip "sin capturar" pide Actualizar, y el canvas las
imprime en ≤ 2 líneas con `…` preservando palabras enteras. El único motor
`makeQuoteCanvas` (`components/quote/ficha-render.ts`) dibuja ficha PNG **2× ⇒ lado mínimo
2160 px ≤ 5 MB** (alto dinámico según contenido; el render embebido pasa por un JPEG intermedio
q .92 con escalada .8/.6/.45 si excede la cota): paleta clara premium, **placa del render
re-proyectada con las 4 luces EXACTAS de la escena** (sin guías, sin pulso, sin watermark) vía
`renderMateView` three offscreen con el **compositor compartido** `lib/compose-engraving.ts`
(pipeline Escala→Espejo→Rotación idéntico a la escena; grabado re-proyectado ≥2048² R8), escudo
logo/iniciales R4 (`resolveBranding` único: white-label SOLO PRO, fallback "MOCAP 3D · MATE
PERSONALIZADO", IG/WA removidos si faltan) y pie del taller con IG/WhatsApp pill/linkId/firma.
El **PDF A4** (`ficha-pdf.ts` + pdf-lib) es un **envoltorio 595.28×841.89 pt del MISMO PNG** con
pie del taller (fuentes estándar + saneo WinAnsi) — jamás re-comprime la imagen. La **Foto HD**
reusa el mismo motor sin grilla (1280 CSS × dpr 2 = 2560 px de lado, escalado a 2160 exactos si
supera 5 MB) con nombre `{taller}-foto-mate-{model}-{aaaammdd}.png`. **Todo export (ficha y
foto) pide y verifica el ticket server-side R7** (`ensureVerifiedTicket` en
`lib/quote/export-flow.ts`: `POST /api/exports/ticket` ⇒ contra-verificación
`/api/exports/ticket/verificar` con hash ligado + UNA re-emisión ante TTL vencido; FREE accede a
la grilla y al export pero el server responde `402` y se abre el Paywall — el candado es
decoración de UI, la decisión la toma el server), confirma el desborde ANTES de bajar
cualquier artefacto con los CTA EXACTOS de la spec R5 ("Exportar de todas formas" / "Volver a
ajustar" — panel propio del modal y mini-diálogo de la shell para Foto HD), registra el QA en
consola via `GET /api/exports?type=png|pdf` (snippet `{user, plan, artifact, at}`) y descarga con
nombre `{taller}-ficha-mate-{model}-{aaaammdd}.png|pdf`.

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
| Test unit | Vitest | 4.1.12 | hoy: **209 tests** (matriz R2 + branding + catálogo + virola/geometría pos 4 + color pos 5 + diseño/rotación pos 6 + desborde/escala pos 7 + ticket pos 8 + ficha snapshot/textos pos 9) |
| 3D | `three` 0.187 + `@react-three/fiber` 9.8 + drei 10.7 | instalados en la posición 3 | LatheGeometry desde el catálogo; escena via `dynamic` con `ssr: false` |
| PDF | pdf-lib | 1.17 (instalado en la posición 9) | envoltorio A4 de la ficha; carga diferida con `import()` |
| Estado cliente | zustand | 5.0 | store del editor = snapshot de `projects.state` |
| Se instalan SOLO al llegar su posición | `zod`, `sharp`, `mercadopago`, Playwright | — | regla vigente: no adelantar deps |

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
│       ├── exports/ticket/route.ts ← ★ POS 8: POST ticket de export — sesión 401 · plan desde users (service-role) ⇒ FREE 402 PAYWALL_REQUIRED / pro ⇒ HMAC 5 min
│       ├── exports/ticket/verificar/route.ts ← ★ POS 9: POST contra-verificación del ticket (HMAC timing-safe + TTL + hash del snapshot ⇒ 403 TICKET_INVALIDO)
│       ├── exports/route.ts        ← ★ POS 9: GET registro QA ?type=png|pdf — 401 sin sesión · plan autoritativo · console.log {user, plan, artifact, at}
│       ├── profile/logo/route.ts   ← POST subida (server revalida por magia de bytes) / DELETE quita logo
│       ├── profile/delete/route.ts ← POST eliminar cuenta: soft-delete + hard-delete proyectos + signOut
│       └── auth/exit/route.ts      ← GET signOut server + redirect /auth?cuenta=inhabilitada
│
├── components/
│   ├── auth/auth-overlay.tsx      ← Google OAuth + email/contraseña + olvidaste tu contraseña
│   ├── profile/profile-panel.tsx  ← tarjetas con guardado inline, indicador 5×20 %, drag&drop del logo
│   ├── profile/danger-confirm.tsx ← doble confirmación R8 (palabra ELIMINAR + botón final)
│   ├── editor/editor-shell.tsx    ← top bar + escena 3D (dynamic ssr:false) + restore + panel gated + watermark/bloqueo DOM por plan (pos 8) + modal #quoteModal y foto HD (pos 9) + tarjeta informativa de variantes + modal del Enlace (10A)
│   ├── editor/top-bar.tsx         ← badge por plan + logo/iniciales + ícono Perfil (todas las plans) + badge demo reactivo 0/1→1/1 (pos 8 R3)
│   ├── links/link-modal.tsx       ← ★ POS 10A: MODAL del ENLACE — vista draft+versiones (badges R5, copiar, WhatsApp, eliminar con confirmación) + publish (402⇒Paywall, confirm de desborde R7 con CTAs, re-encode R3) + resultado (Copiar/Enviar/vence)
│   ├── links/variants-card.tsx    ← ★ POS 10A: tarjeta "Variantes del Enlace" — decisión nov-2026: A/B/C desactivadas, aviso "Solo se puede enviar un diseño por ahora" (el borrador legacy en projects.state se conserva)
│   ├── links/client-viewer.tsx    ← ★ POS 10A: MODO CLIENTE UI — assets×URL única (fail⇒"no disponible"), crossfade ≤300 ms, chips A/B/C solo en links legacy, acordeón, CTA R6 (POST ANTES de wa.me · reintentos backoff · código APROBADA literal) + págs amables
│   ├── links/viewer-scene.tsx     ← ★ POS 10A: ESCENA 3D PÚBLICA — mismas libs del editor (lathe+PBR+compositor) pero para el payload congelado; giro 0.5 RPM pausable, cámara fijada por silueta, SIN guías/medidas/watermark
│   ├── paywall/paywall-modal.tsx  ← laurel: precio dinámico + beneficios + CTA MP (desactivado hasta Checkout Pro: pos 10)
│   ├── quote/quote-modal.tsx      ← ★ POS 9: MODAL #quoteModal — snapshot inmutable + grilla 9 tarjetas + observaciones (sesión) + confirmación de desborde + export PNG/PDF con ticket R7
│   ├── quote/ficha-render.ts      ← ★ POS 9: ÚNICO MOTOR — renderMateView (3 luces de escena, sin guías/watermark) + makeQuoteCanvas (PNG 2× ≥2160 ≤5MB) FUERA del chunk inicial (import() dinámico)
│   ├── quote/ficha-pdf.ts         ← ★ POS 9: envoltorio A4 del MISMO PNG (pdf-lib, pie del taller, saneo WinAnsi) — import() diferido
│   ├── quote/foto-hd.ts           ← ★ POS 9: flujo Foto HD (confirmación de desborde + ticket + render 2560 px + descarga fotoFileName)
│   ├── session/plan-watcher.tsx   ← Realtime: UPDATE en users ⇒ router.refresh() (sin reload)
│   ├── studio/studio-scene.tsx    ← ESCENA 3D pos 4–8: cuerpo lathe + virola 3 mallas PBR + grabado (escala→espejo→rotación via compositor compartido) + guías + pulso de desborde + auto-giro + WATERMARK cocida (pos 8)
│   ├── studio/product-selector.tsx ← radio-cards (radiogroup) con siluetas SVG derivadas del catálogo
│   ├── studio/dimensions-card.tsx ← TARJETA MEDIDAS pos 4: D_ext/D_int + steppers + sliders dinámicos + métricas + guías
│   ├── studio/color-picker-card.tsx ← TARJETA COLOR pos 5: presets PBR + #HEX (dot nativo) + recientes + quemado
│   ├── studio/design-card.tsx     ← TARJETA DESIGN pos 6–7: archivo SVG/PNG (SVG a resolución FINAL: envoltorio 1024²) + rotación (imán/presets/reset) + espejo + escala 70–110 % + banner chorreo
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
│   ├── design.ts                  ← ★ DISEÑO DEL GRABADO pos 6–7: rotación R3 canónico 0.5° + imán R4 ±4° (dispositivo) + estado design {rotation, scale, mirror} + asset con baseSideMm (R1)
│   ├── overflow.ts                 ← ★ MOTOR DESBORDE pos 7: envolvente de tinta R4 + evaluación 0 mm estricta + bbox degradado §6 + largestSafeScalePct R7 (función testeada; UI retirada por decisión del titular) + textos banner/ficha R5/R6
│   ├── exports/ticket.ts           ← ★ POS 8: ticket de export HMAC-SHA256 v1 (5 min EXACTOS, b64url) + verify timing-safe — forma de spec_detalle R7 que ficha pos 9 consume
│   ├── exports/ticket-server.ts    ← ★ POS 9: helpers de server compartidos (ticketSecret env + planOf fail-closed service-role) — las 3 rutas de /api/exports usan EL MISMO
│   ├── quote/snapshot.ts           ← ★ POS 9: SNAPSHOT INMUTABLE R1/R2/R3/R5/R8 (captureFichaSnapshot + formatos de tarjeta + hash FNV f1: EXCLUYENDO capturedAt + currentOverflowCheck derivación única)
│   ├── quote/texts.ts              ← ★ POS 9: wrapObservations (≤2 líneas `…` preserva palabras) + MCU 280 + nomenclatura §5 ficha/foto
│   ├── quote/export-flow.ts        ← ★ POS 9: flujo de export compartido cliente (ticket→verificar con UNA re-emisión R7 · cota 5MB · downloadBlob · registro QA)
│   ├── compose-engraving.ts        ← ★ compositor compartido del grabado (extraído de studio-scene en pos 9): Escala→Espejo→Rotación + tinte burn + máscara anular — la escena y la ficha usan EL MISMO pipeline
│   ├── links/identity.ts           ← ★ POS 10A: linkId R2 (6 chars [a-z0-9], canónico case-insensitive) + colisiones inyectadas
│   ├── links/payload.ts            ← ★ POS 10A: payload schemaVersion 2 (R4 fracción/rotación/labels≤40) + risk R7 congelado + linkDraft legacy A/B/C (StoredVariantRow) + `buildPublishVariant` (publish actual de UN diseño)
│   ├── links/states.ts             ← ★ POS 10A: vigencia/estados R5 (prioridad aprobado>vencido>por_vencer) + URL canónica + wa.me share/aprobación R6/R8 + código APROBADA + RPM del visor
│   ├── links/asset-encode.ts       ← ★ POS 10A: re-encode client-only (PNG ≤300 KB escalera 1024/768/512 con alpha) + original ≤10 MB
│   ├── links/view-shape.ts         ← ★ POS 10A: buildPublicView (jsonb ⇒ vista del visor: re-arbitra contratos, presets válidos, gating por asset, legado 1:1)
│   ├── store/editor.ts            ← zustand: estado del editor = snapshot de projects.state (color/diseño pos 5–6 + escala/espejo/inkEnvelope pos 7)
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
│   │   └── 0004_shareable_links.sql     ← POS 10A: links (insert-only, RLS owner select) + link_approvals (INSERT público con link_open_for_approval) + buckets link-assets (público lectura) / designs (privado) (aplicada 06-nov)
│   └── ops/
│       ├── 0901_backfill_user_rows.sql ← reparación: fila faltante en public.users (cuenta nacida pre-migración)
│       ├── 0910_base_grants.sql        ← grants ampliados users/projects/pricing (aplicada 04-nov)
│       └── 0920_purge_deleted_accounts.sql ← R8: restauración manual + purga a 30 días (soporte / pg_cron)
│
├── tests/
│   ├── unit/permissions.test.ts   ← 8 tests: invariantes de la matriz R2
│   ├── unit/links-core.test.ts    ← 23 tests pos 10A: R2 (6 chars/canónico/colisiones), R4 (fracción/módulo/labels truncado), R5 (30 d + ≤5 d con prioridad), R6 texto, R8 wa.me EXACTO
│   ├── unit/branding.test.ts      ← 23 tests: fallbacks, CTA R5, E.164, Instagram, completitud
│   ├── unit/catalog.test.ts       ← 13 tests: QA1 matemático, labio anti-fuga R4, R8, corrupción §6
│   ├── unit/color.test.ts         ← 32 tests: tabla PBR R1, exclusividad/recientes R3, quemado R4 (luminancia), descriptores R5
│   ├── unit/design.test.ts        ← 28 tests: R3 normalización/módulo, parseo del campo °, imán R4 ±4° (QA3), persistencia design pos 6–7 + envolvente de sesión
│   ├── unit/overflow.test.ts      ← 27 tests: escaneo polar R4 (0 mm estricto; dentada/muesca QA2), evaluación lineal R2/R3, bbox §6, Auto R7, textos R5/R6
│   ├── unit/export-ticket.test.ts ← 7 tests pos 8: ida/vuelta HMAC, vigencia 5 min exacta, forjado/otro secreto, tamper de UN byte, replanificación de JSON ⇒ null, cotas de datos
│   ├── unit/quote-texts.test.ts     ← 16 tests pos 9: wrapObservations R5 (≤2 líneas, `…` preserva palabras, overlong word), MCU 280, slug/nomenclatura §5 EXACTA ficha/foto
│   ├── unit/quote-snapshot.test.ts  ← 24 tests pos 9: formatos R2 EXACTOS, descriptores R3 (sin auto-nombres), margen canónico R5, R8 fallbacks + warns, hash estable excluyendo capturedAt, currentOverflowCheck
│   ├── unit/links-view.test.ts    ← 10 tests pos 10A: buildPublicView re-arbitra contratos (v2 + basura polite + presets válidos + legado 1:1 + ids inválidos fuera), código APROBADA EXACTO + texto/href wa.me de aprobación
│   └── unit/virola.test.ts        ← 31 tests: R1 clamps/rangos dinámicos, R2 métricas, R3 cascada <100ms, R4/R5 guías coplanares, R6 triada, R7 auto-giro
├── three/README.md                ← índice del motor 3D + contrato de costura UV (posiciones 3–7)
├── three/visual-skeleton.ts       ← constantes visuales pos 4 + LATHE_SEAM_PHI_START
├── three/guides.ts                ← GUÍAS DE SIMETRÍA pos 4: coplanares en corona superior plana (círculos + ejes radiales + ticks)
├── three/lathe-builder.ts         ← CUERPO + VIROLA 3 MALLAS: corona superior plana + faldón exterior + pared interior boca
└── (node_modules / .next / package-lock…)
```

---

## 5. Lo que quedó implementado (posición por posición) — con su criterio QA

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
| 11 | Slot 1/1 del demo (badge reactivo 0/1→1/1, reemplazo libre R3), watermark cocida y DOM bloqueado, 402 de export | ✅ pos 8: badge cuenta el asset de sesión (cuota server-side real: pos 10) · banda WebGL plan free · `POST /api/exports/ticket` (402 FREE / ticket 5 min PRO) | ✅ |

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
| R5 | Descriptor canónico para Ficha/Cotización | `formatColorDescriptor()` (ej. `"Virola: #2A2A2A · Anodizado Personalizado"`) | ✅ (consumido por la ficha pos 9: tarjetas con descriptores FIJOS, sin auto-nombres) |
| R7 | Persistencia del color (bodyPreset/metalPreset/bodyColor/virolaColor/recentColors) | 5 claves nuevas del snapshot + `normalizeState` tolerante (legacy `topFaceColor` ⇒ `virolaColor`) | ✅ |
| §4 | Tarjeta "Materiales y Acabados" (tercera del panel — decisión del titular: sin pestañas) | `components/studio/color-picker-card.tsx` (dot nativo + swatches + recientes) | ✅ |

**Nota de la entrega (05-nov):** el quemado R4 todavía **no** se dibuja sobre la escena — es el
tono del GRABADO y su consumidor natural es la capa de diseño de la posición 6 (que lo leerá de
`adaptiveLaserBurn()`); pos 5 solo fija y testa la regla.

### Posición 6 — Rotación del grabado SVG/PNG (según `spec_rotacion_archivo_svg_png.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Marco canónico único (0° = eje de costura; preset "0° Frente"; pivote centro del carril) para TODOS los productos | ancla compartida `LATHE_SEAM_PHI_START` + canvas polar de la corona (frente = borde superior); el grabado vive DENTRO del grupo que rota con auto-giro/guías | ✅ |
| R2 | Orden de composite: escala(7) → espejo(7) → **rotación al final** | `composeEngravingCanvas` en `studio-scene.tsx`: rotar ÚLTIMO sobre el pivote exacto (QA1: pivote invariable) | ✅ (escala/espejo resueltos en pos 7) |
| R3 | Ángulo canónico único [0°, 360°) paso 0.5°, sin bipolar −180/180 | `normalizeRotation` + `parseRotationInput` en `lib/design.ts` (370⇒10 · −90⇒270 · 45.25⇒45.5 · 360⇒0) | ✅ (testeado) |
| R4 | Imán ±4° ON default (SOLO dispositivo) + 4 presets exactos + reset a 0° | `magnetSnappedPreset`/`applyMagnet` + localStorage `mocap:design-snap-magnet` (nunca jsonb — §5) | ✅ (QA3: 17.5° exacto) |
| R6 | Re-chequeo de desborde al rotar (banner inmediato) | **Resuelto en pos 7**: anclaje R1 + motor de `lib/overflow`; el giro NO dispara re-chequeo (invariancia polar R3) | ✅ |
| R7 | `design.rotation` en `projects.state` + nota ficha "45° / 45.5°" | clave `design` del snapshot + `normalizeState` tolerante (legacy ⇒ 0°) + `formatRotationLabel` | ✅ |
| R8 | Re-muestreo: SVG/PNG raster en vivo 1024² (Ficha HD ≥2048² llega en pos 9) | `rasterizeDesignFile` en cliente (SVG vectorizado nativo; PNG smoothing 'high') + CanvasTexture viva | ✅ |
| §4 | Tarjeta "Cargar Archivo / Edición del Vector" con slider/campo/presets/imán/reset | `components/studio/design-card.tsx` (cuarta del panel) | ✅ |
| §6/§7 | Rotación FREE (sin candado); Modo Cliente sin controles | sin capability nueva en matriz R2; el MODO CLIENTE llega con pos 10 | ✅ |

**Notas de implementación (05-nov):** (1) **mapeo de preset anotado** — en el canvas polar de la
corona el borde superior es el Frente (+Z con cámara por defecto), así los presets caen con las
etiquetas EXACTAS de la spec; la costura real de la lathe (ancla de guías pos 4) queda al dorso,
da igual para la rotación del diseño que rota el receptor completo. (2) **Ajuste provisional del
carril (SUSTITUIDO en pos 7)** — la inscripción en el círculo inscrito de la banda
($W_{banda}/\sqrt2$) quedó detrás del anclaje real R1: era la causa del reporte *"el SVG cargado
no se visualiza en la virola"* — al inscribir el diseño centrado en el eje, la máscara anular
borraba TODO lo dibujado dentro del hueco R_int. Hoy `composeEngravingCanvas` dibuja
FULL-canvas con base mm congelada (R1). (3) **Fallo de raster** (SVG corrupto tras edición
externa): se conserva la última textura válida con aviso inline (§6); reintentar reactiva el
diseño.

### Posición 7 — Escala fina + motor de desborde "chorreo" (según `spec_escala_y_alerta_de_desborde.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Anclaje del 100 %: fit inicial fijo (envolvente tocando el anillo al cargar), congelado; editar D_ext/D_int NO re-escala, solo re-chequea | `DesignAsset.baseSideMm` al cargar + `composeEngravingCanvas` FULL-canvas (el % multiplica solo esa base) | ✅ |
| R2 | Pipeline canónico Escala → Espejo → Rotación al MISMO pivote (espejo aplazado por pos 6) | `composeEngravingCanvas`: `scale/espejo` antes de `rotate` — la rotación gira exactamente lo que se ve | ✅ |
| R3 | Motor único con disparadores escala/D_ext-D_int/carga de diseño; invariancia polar (ángulo/espejo jamás re-chequean) | envolvente de tinta (2 escalares) + `evaluateOverflow` O(1) por estado | ✅ (arquitectural, testeado) |
| R4 | Escaneo polar exacto 512² (α ≥ 128), tolerancia 0 mm ESTRICTA (tocar ≠ desbordar), desvío en mm (1 decimal), chequeo ≤ 25 ms | `scanInkEnvelope` + `measureInkEnvelopeMm` al cargar (QA2: barrido ≤ 25 ms, test) | ✅ (27 tests) |
| R5 | Banner con redacción EXACTA (mm 1 decimal); estados Seguro/Desborde + guías afectadas en rojo con pulso 500 ms | `overflowBannerText` + `PulseGuideLine` (`#FF3B30`, overlay en `GuidesLayer`) | ✅ (ámbar→rojo @2 mm: nota visual anotada) |
| R6 | Ficha: "Margen: seguro" / "con riesgo (excede X mm)"; export con desborde exige confirmación | `marginSheetLine()` consumido por la ficha pos 9 (grilla + canvas) y la confirmación del export usa los CTA exactos | ✅ función + consumo pos 9 |
| R7 | Botón Auto: mayor escala segura ≤ 110 % (binaria descendente con forma exacta) + presets 85/90/100 sin "Máx" | **UI RETIRADA por decisión del titular (05-nov)**: la mayor escala segura la elige el tallerista con slider/banner; `largestSafeScalePct` (forma cerrada O(1)) queda testeada en `lib/overflow` y pos 9/10 pueden reusarla | ✅ función · 🚫 UI retirada |
| R8 | `design.scale`/`design.mirror` persisten (legacy ⇒ 100 % / OFF); el estado de margen JAMÁS se persiste | snapshot + `normalizeState` tolerante (115⇒110 · 65⇒70 con aviso) + `inkEnvelope`/`inkScanDegraded` de sesión | ✅ |
| §6 | Raster del chequeo falla ⇒ modo envolvente (bbox) CONSERVADOR con aviso "Detección aproximada" | `evaluateOverflowBBox` + flag `inkScanDegraded` | ✅ |

### Posición 9 — Ficha técnica + Foto HD + registro QA (según `spec_detalle_del_modelo_en_ficha.md`)

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Snapshot inmutable al abrir (badge "Actualizado a las HH:MM" + Actualizar re-captura); JAMÁS en `projects.state` | `captureFichaSnapshot` (`lib/quote/snapshot.ts`) en `quote-modal.tsx` — transitorio en memoria + hash f1: del contenido | ✅ |
| R2 | Grilla 9 tarjetas / 3 secciones con formatos EXACTOS (`123.0 mm` SIEMPRE 1 dec; `92%`/`92.5%`; `45°`/`45.5°`; bandería auto W=(Dext−Dint)/2; faltante ⇒ `—`) | formatos en `snapshot.ts` + grilla React espejo + las MISMAS tarjetas dibujadas en `makeQuoteCanvas` (medición en pasada 1, dibujo en pasada 2) | ✅ (40 tests) |
| R3 | Descriptores FIJOS (`#2A2A2A · Anodizado Personalizado` / `#E6C48E · Color Libre`); presets por su nombre; NUNCA auto-nombres | `stripZonePrefix` + `formatColorDescriptor` único consumido por grilla y canvas | ✅ |
| R4 | Degradación de marca via `resolveBranding()` (white-label SOLO PRO; sin logo ⇒ escudo iniciales; título fallback MOCAP 3D; IG/WA removidos si faltan); jamás bloquea el export | `captureFichaSnapshot` con `brand` resuelto; canvas: escudo logo/iniciales + pie condicional (IG en línea + pill WhatsApp solo con E.164) | ✅ |
| R5 | Observaciones máx 280 + contador; canvas ≤ 2 líneas con `…` preservando palabras; sin texto ⇒ sin bloque; el texto de sesión sobrevive re-abrir | `wrapObservations` (`lib/quote/texts.ts`, inyectable) + textarea en modal con obsText en la shell + chip "sin capturar" | ✅ |
| R6 | Único motor `makeQuoteCanvas`: PNG 2× lado mínimo 2160 px ≤ 5 MB; PDF = envoltorio A4 del MISMO PNG con pie del taller + linkId si corresponde | `ficha-render.ts` (2 pasadas; JPEG intermedio del render con escalada .8/.6/.45) + `ficha-pdf.ts` (A4 595.28×841.89, `embedPng`, fuentes estándar + WinAnsi) | ✅ |
| R7 | Export con ticket server-side: FREE ⇒ 402 + Paywall; PRO ⇒ descarga; ticket 5 min ligado al hash; verificar antes de adjuntar | `ensureVerifiedTicket` (`export-flow.ts`): `/ticket` → `/ticket/verificar` (403 TICKET_INVALIDO) + UNA re-emisión; FREE entra a la grilla y al export — el server decide (candado decorativo) | ✅ |
| R8 | Fallbacks: modelo desconocido ⇒ "Mate Camionero"; escala/rotación ausentes ⇒ 100 %/0°; datos inválidos ⇒ `—` + aviso en consola | `formatModeloCard` (catálogo pos 3) + normalizadores pos 6/7 + `vigente()` con `console.warn` | ✅ |
| §4 | Confirmación de desborde ANTES de exportar (Ficha y Foto HD) con CTA EXACTOS "Exportar de todas formas"/"Volver a ajustar" | panel interno del modal (`overflowBannerText` pos 7 + CTAs) y mini-diálogo Promise-based en la shell para Foto HD | ✅ |
| §4 | Foto HD: render solo, misma infra de ticket+confirmación, sin grilla | `components/quote/foto-hd.ts`: `runFotoHdExport` — render 2560 px lado (dpr escalado a 2160 si excede 5 MB), nombre `{taller}-foto-mate-…` | ✅ |
| §6 | "Sin diseño cargado" = slot de sesión vacío: Grabado con placeholder, Producto/Acabados imprimen igual | `grabadoSinDiseno` (snapshot) ⇒ tarjetas con placeholder; modal sin error | ✅ |
| §5 | Sin entidades DB nuevas (snapshot transitorio); nombre de archivo `{taller}-ficha-mate-{model}-{aaaammdd}.png|pdf` | nada nuevo en migraciones; `slugTaller`+`formatFileDate` en `texts.ts` | ✅ |
| §7 | Registro QA de exports: consola del server `{user, plan, artifact, at}` + JSON 200 | `GET /api/exports?type=png|pdf` + `POST /api/exports/ticket/verificar` (401/400/403/200) | ✅ (401 smoke) |
| §3 | La escena y la ficha comparten pipeline del grabado (un solo motor, jamás duplicado) | `composeEngravingCanvas` extraída a `lib/compose-engraving.ts` — studio-scene y ficha-render la importan | ✅ |
| §3 | Ficha/Foto HD: vista **cenital** (≈15°) para que el grabado de la corona se lea y re-proyección HD completa | `TOP_VIEW_OFFSET_MM`/`TOP_VIEW_FIT_MARGIN` en `three/framing.ts` + `drawImage` full-canvas en `compose-engraving.ts` (escala 1024² → 2048²) | ✅ |

### Posición 10A — Enlace comercial compartible + Modo Cliente (según `spec_ficha_comercial_interactiva_shareable_link.md`)

La posición 10 se separó por decisión del titular (06-nov): **10A** entrega el ciclo completo
de los enlaces (publish versionado + visor público + aprobación por WhatsApp) y **10B** queda
para Mercado Pago (`spec_pagos.md`).

| Ref | Requisito | Implementación | Estado |
| :--- | :--- | :--- | :--- |
| R1 | Links versionados inmutables: cada regeneración crea `linkId` NUEVO (`version=max+1`), jamás UPDATE de payload; panel de versiones con historial y agregados de aprobaciones | tabla `links` insert-only (0004 con RLS owner) + `POST /api/links` + `GET /api/links?projectId=` (desc, con counts de aprobaciones por versión) | ✅ |
| R2 | `linkId` 6 chars `[a-z0-9]`, canónico case-insensitive, colisiones con reintentos; URL `/v/{id}` canónica desde el origin del request | `lib/links/identity.ts` (`generateUniqueLinkId` inyectable) + `canonicalLinkUrl` | ✅ |
| R4 | Payload `schemaVersion 2` por variante: label ≤40 truncado elegante, escala %⇒fracción 0–1.10 (3 dec), rotación módulo 360°, espejo; legacy inline ⇒ renderiza 1:1 | `lib/links/payload.ts` + `buildPublicView` (`view-shape.ts`) re-arbitra TODOS los contratos server-side al leer el jsonb (23 tests core + 10 de visor) | ✅ |
| R3 | Assets re-encodados ≤1024²/≤300 KB en URLs de larga vida (adiós al base64 de MB); original preservado; brand congelado POR VERSIÓN de link | textura: PNG escalera 1024/768/512 (alpha intacto) → `link-assets/{id}/` público + original ≤10 MB → `designs/{user}/{project}` privado + logo del taller copiado a `{id}/logo.png` (fallo ⇒ degrada a iniciales); `mateConfig` armado SERVER-SIDE desde `projects.state` (el cliente no manda config) | ✅ |
| R5 | Vigencia 30 días + "por vencer" ≤5 días (badge ámbar + sugerir regenerar); prioridad aprobado>vencido>por_vencer>vigente; vencido ⇒ página amable (jamás redirect a otra versión) | `lib/links/states.ts` (`linkEditionState`/`editionBadgeText`) + `ExpiredNotice` en `/v` (marca del taller + CTA de contacto) | ✅ |
| R7 | Publicar con desborde exige confirmación + `risk` CONGELADO INTERNO por variante (el cliente jamás lo lee) | `currentOverflowCheck` por variante + mini-diálogo de la shell reutilizado con CTAs "Publicar de todas formas"/"Volver a ajustar" + `LinkVariantRisk` en el payload (accesible solo desde el panel del editor) | ✅ |
| R8 | Paywall server-side al publicar (FREE ⇒ **402** + Paywall); abrir/ver/aprobar el enlace NO paga ni loguea | plan desde `users` con service-role fail-closed en POST; el middleware deja `/v` deliberadamente FUERA del redirect a `/auth` (comentario documentado) | ✅ |
| R6 | Aprobación pública acumulable registra ANTES de abrir WhatsApp; valida la variante contra el payload; texto nombra la opción EXACTA; badge "APROBADO Opción B" en editor; sin número ⇒ código `APROBADA-{VARIANTE}-{LINKID}` copiable (spec usuario R5) + "Ponete en contacto con tu vendedor…" | `POST /api/links/[linkId]/approvals` (404 inexistente / 410 vencido) + INSERT con cliente ANÓNIMO ⇒ la DB (RLS `approvals_public_insert`) es la última palabra; CTA del visor con reintentos backoff y `wa.me` garantizado si hay E.164 válido | ✅ |
| Decisión | **Nov-2026: un solo diseño por enlace** (A/B/C desactivadas) — el publish congela la rotación/escala/espejo VIGENTES del editor como opción `A`; los links legacy con A/B/C siguen abriéndose y el borrador viejo se conserva sin editarse | tarjeta `variants-card.tsx` (aviso "Solo se puede enviar un diseño por ahora") + `buildPublishVariant`/`PUBLISH_VARIANTS_MAX` + `POST /api/links` exige exactamente 1 variante; `client-viewer` oculta el selector si hay una sola | ✅ |
| Límite | No hay tope de enlaces por cuenta: cada publish crea una versión nueva; el panel pide hasta 100 por proyecto (las más nuevas) y FREE no publica (402). El borrado propio libera lugar | `GET /api/links?projectId=` con `.limit(100)` + `DELETE /api/links/[linkId]` con service-role | ✅ |
| §4 | Modal de generación: URL + `[Copiar Enlace]` + `[Enviar por WhatsApp]` con mensaje EXACTO de la spec; panel de versiones con estado vigente/por vencer/vencido/aprobado, fechas, regeneración y **borrado de una versión propia** | `link-modal.tsx` — share via `whatsappShareHref` a `wa.me/?text=` SIN destinatario (selector de contactos; el E.164 del Perfil es el destino de la aprobación, no del envío) + badges del panel + `DELETE /api/links/{id}` (service-role: ownership, `link_approvals` por cascade y limpieza de `link-assets/{id}`) | ✅ |
| §4 | Modo Cliente: top bar glassmorphism (logo+nombre+“Vista Previa Oficial”), giro 0.5 RPM pausable por el dedo (reanuda al soltar), crossfade ≤300 ms sin resetear cámara/giro, chips A/B/C solo si el payload legacy trae varias + acordeón Modelo/Virola (mm)/Cuerpo — JAMÁS margen/medidas técnicas/marca de agua | `client-viewer.tsx` + `viewer-scene.tsx` (misma librería 3D del editor — lathe/PBR/compositor/cámara por silueta — parameterizada por payload; fade por capas de la MISMA textura) | ✅ |
| §6 | Páginas amables del visor: inexistente/vencido/no disponible; variante con asset caído queda deshabilitada y las demás siguen operando | `app/v/[linkId]/page.tsx` (service-role, `expires_at` ANTES de servir contenido) + `not-found.tsx` propio del segmento + gating de assets en el visor | ✅ |
| Passthrough | La Ficha técnica imprime `Enlace comercial {linkId}` del enlace VIGENTE (hueco dejado en pos 9) | la shell consulta `GET /api/links` al abrir `#quoteModal` y estampa `captureFichaSnapshot.linkId` | ✅ |

Desviaciones documentadas (todas MÁS estrictas que la spec): lectura del link con **service-role**
en la página pública (la spec proponía "vista segura"; el server nunca expone el jsonb),
`mateConfig` construido server-side (el cliente solo manda la config del diseño vigente) y
publish de UNA sola variante desde nov-2026 (el visor conserva la lectura A/B/C legacy). Evidencia
en la fila QA del §8.

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

La **capa de diseño** (pos 6–7) extiende el estado con `design: {rotation, scale, mirror}`:
cargar archivo ⇒ se mide la envolvente de tinta (sesión) ⇒ escalar o editar medidas
re-chequea el desborde al vuelo (O(1)); la rotación y el espejo NO disparan re-cálculo
(invariancia polar R3), y con desborde activo el banner + el pulso rojo de las guías
persisten hasta corregir. El margen jamás viaja en el autosave (es derivable).

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
| Migración `0004_shareable_links.sql` | ✅ aplicada 06-nov (titular) — links + link_approvals + grants (ver incidentes 10A de abajo) |
| Migración `0005_subscriptions.sql` | ✅ aplicada y verificada 07-nov por REST — `subscriptions` + `payments` + `grace_expires_at` (el fix `ab90418` corrigió el drift del schema del ciclo) |
| Cuentas de prueba MP del taller (07-nov) | ✅ vendedora-test del app: `TESTUSER2051836120` (id 2163208142 — el token de `.env` es SU `APP_USR`); compradora-test: `test_user_532412195559500595@testuser.com` / `rtPtaVCKO1` (creada vía API `POST /users/test_user`); plan de prueba ACTIVO: `336d29cd…` (20.000 ARS/mes, sirve para mintear `init_point` de demos); TODAS las preapproals de QA canceladas (`4a9bf222…`, `42f1f4b9…`, `93d6502a…`, `1bfa10ce…` — la última cancelada POR EL TITULAR desde el portal del comprador) |
| Webhooks en modo TEST (07-nov) | ✅ MP NO llamó Jamás al `notification_url` (dropeó el campo en creaciones por plan y en la página hospedada) ⇒ protocolo QA: pull del recurso a MP + re-envío del evento firmado a mano con `MP_WEBHOOK_SECRET` (manifiesto `id;request-id;ts;` testado). En prod la entrega webhook con `x-signature` válida es el camino natural — ver spec de ida a producción |
| Túnel dev (ngrok free) | ✅ `MP_PUBLIC_ORIGIN` activo; el interstitial "you are about to visit…" es una vez por browser de cada visitante (capa gratuita, sin impacto) |

### Incidentes reales vividos en el primer setup → cómo quedaron resueltos

| Incidente observado | Causa real | Solución (dónde quedó) |
| :--- | :--- | :--- |
| `pricing_config read error: permission denied` (`GET /api/config/pricing 500`) | el proyecto no aplica los GRANT automáticos de Supabase sobre tablas creadas por SQL editor | `grant select on pricing_config to service_role` — embebido en `0001` y reproducible en `ops/0910_base_grants.sql` |
| Cartel "No existe fila en public.users" persistente | `(a)` cuenta nacida ANTES del trigger (los triggers no se aplican retroactivamente) + `(b)` el editor tragaba el error de lectura | backfill `ops/0901_backfill_user_rows.sql`; además el editor ahora logea el error real en la terminal |
| Re-crear un email ya borrado fallaba ("No pudimos crear la cuenta") | Confirm email ON ⇒ cada registro dispara email ⇒ tope de emails por hora en el plan free | Confirm email = OFF (estado correcto del producto según la spec — fricción cero) |
| Sin botón de cerrar sesión con plan free | el logout solo existía dentro del menú visible para PRO | fix top-bar: icono de sesión siempre disponible (commit `c8edbcf`) |
| `[projects] save: "new row violates row-level security policy"` al autosave (QA pos 3, 04-nov) | `projects.user_id` sin `default auth.uid()` (migración 0001): el INSERT del autosave llegaba con `user_id = NULL` y el `with check` de `own_projects` lo rechazaba | migración `0003_projects_owner_default.sql` — aditiva (solo SET DEFAULT); en fresh setups el patrón ya arranca acá |
| `/perfil`: los 4 campos morían con `permission denied for table users` + el logo con "El Storage estaba caído" (QA pos 2, 04-nov) | los grants de `ops/0910` habían quedado cortos: `authenticated` solo tenía `select` de users y `service_role` nada — GRANT se evalúa ANTES de RLS, así que ni el update del panel ni el de `logo_url` del server llegaban a la política; además el catch de la ruta del logo disfrazaba el fallo de DB como 503 "Storage caído" | `ops/0910` ampliado (sumativo): `update` para `authenticated` + `select, update` para `service_role` en users; la ruta del logo ahora distingue Storage (503) de persistencia de la fila (500 `GUARDADO_FALLIDO`) con mensajes honestos en el panel — **confirmado 04-nov: tras re-correr el ops, campos y logo responden** |
| `GET/POST /api/links` ⇒ **404** `PROJECT_NOT_FOUND` con el proyecto PROPIO (QA pos 10A, 06-nov) | el publish es el PRIMER código del app que lee `projects` con **service-role** y el grant de `ops/0910` no incluía esa tabla; `links`/`link_approvals` (0004) nacieron sin grants para nadie — mismo class del bug 0002: "BYPASSRLS salta la política pero NO el GRANT"; el handler tragaba `owned.error` en un 404 sin log, tapando el `permission denied for table projects` real | `ops/0910` ampliado (sumativo): **`select` en `projects`** para `service_role` (v2 del fix: el primer bloque lo omitió y el retry del titular lo demostró con `[links ownership]: permission denied for table projects`), `select,insert,update,delete` en `links` + `select` en `link_approvals` para `service_role`, e `insert` en `link_approvals` para `anon` (POST público pasa por la RLS `approvals_public_insert`); ambos handlers logean `[links ownership]` antes del 404 — **pendiente confirmar el retry tras re-correr el ops** |
| `POST /api/links/{id}/approvals` ⇒ **503** `APPROVAL_UNAVAILABLE` — `permission denied for table link_approvals` con el link ya publicado (QA pos 10A, 06-nov) | el route pedía `insert().select('approved_at').single()` ⇒ PostgREST manda `INSERT … RETURNING` y Postgres exige el privilegio **SELECT** para el `RETURNING` — la 0004 lo tiene revocado de anon POR DISEÑO (§60: "SELECT/UPDATE/DELETE jamás para anon"); los grants estaban bien: el route violaba el contrato de su propia DB | el route inserta con `return=minimal` (sin RETURNING anónimo): la `WITH CHECK` de la policy sigue siendo la última palabra (link vencido/inexistente lo rechaza la DB), el eco `approvedAt` lo resuelve el server y la verdad la lee el panel del taller (service GET). Sin SQL extra: el `grant insert … to anon` de ops/0910 es suficiente — el retry de la aprobación corre el titular con el dev server actualizado |

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
| `npm run typecheck` (tsc --noEmit, strict) | ✅ **0 errores** (con las posiciones 4–10B adentro) |
| `npm run test` (Vitest) | ✅ **285/285** — 8 de matriz R2 + 23 de branding + 13 de catálogo (+`linkDraft`) + 31 de virola pos 4 + 32 de color pos 5 + 28 de diseño pos 6–7 + 27 de desborde/escala pos 7 + 7 de ticket export pos 8 + 16 de textos ficha pos 9 + 24 de snapshot ficha pos 9 + 23 de links core + 10 de visor pos 10A + **32 de pagos core + 11 de webhook/firma pos 10B** |
| `npm run build` (producción) | ✅ **19 rutas** — nuevas `/api/billing/checkout` + `/api/webhooks/mercadopago`; `/editor` 29.3 kB / 221 kB First Load y `/perfil` 10.3 kB / 196 kB (el Centro de Suscripción se lee server-side con la RLS del dueño); `/v/[linkId]` 5.41 kB / 125 kB (el Modo Cliente NO hincha el editor: escena R3F por `dynamic ssr:false`); el motor 3D y pdf-lib siguen en chunks propios y los módulos de pagos server-only no se infiltran en bundles cliente (`import()` dinámico del modal — nunca dentro del HTML inicial) |
| Smoke prod sin envs (pos 1) | `/` 307→`/setup` · `/auth` 307→`/setup` · `/setup` 200 |
| Smoke runtime real con `.env` (04-nov, pos 1) | login PKCE → `/editor 200` · `/api/config/pricing` **200** · fila derivada en DB (`Kherrera`) · logout visible free |
| **Smoke gating pos 2** (server efímero 7434, sin sesión) | `/perfil` 307→`/auth` · `POST /api/profile/logo` 401 · `POST /api/profile/delete` 401 · `/api/auth/exit` 307→`/auth?cuenta=inhabilitada` · `/auth?cuenta=eliminada` 200 |
| **Smoke gating pos 3** (server efímero 7435, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 — el guard de ruta sobrevive al nuevo canvas |
| **Smoke gating pos 5** (server efímero 7436, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 · `/api/config/pricing` 200 — el guard y el precio sobreviven al color |
| **Smoke gating pos 6** (server efímero 7437, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 · `/api/config/pricing` 200 — el guard sobrevive al grabado con rotación |
| **Smoke gating pos 7** (server efímero 7438, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 · `/api/config/pricing` 200 — el guard y el precio sobreviven a la escala/desborde |
| **Smoke gating pos 8** (server efímero 7450, sin sesión) | `/editor` 307→`/auth` · `/auth` 200 · `/api/config/pricing` 200 · **`POST /api/exports/ticket` ⇒ 401 AUTH_REQUIRED** — la seam de licencia vive SIN sesión; el QA del 402 FREE / ticket PRO corre con sesión real (flip de `users.plan` en DB) |
| **QA Posición 4** (05-nov) | Corona superior plana con normales +Y ✅ · guías concéntricas coplanares en X-Z ✅ · cascada <100 ms ✅ · sliders dinámicos R1 ✅ · auto-giro 0.75 RPM + pausa/play ✅ · fix de loop React 19 memoizado ✅ |
| **QA Posición 5** (05-nov) | Tabla PBR canónica ✅ · anodizado 0.10/0.45 y cuerpo libre 0.00/0.82 ✅ · exclusividad preset⇄hex ✅ · recientes máx 6 ✅ · quemado L 0.55 con ambas ramas ✅ |
| **QA Posición 6** (05-nov, técnica) | R3 módulo/paso ✅ (370⇒10, −90⇒270, 45.25⇒45.5, 360⇒0) · imán ±4° con envolvente ✅ + 17.5° exacto imán OFF (QA3) ✅ · preset EXACTO con imán ON/OFF ✅ · persistencia legacy ⇒ 0° ✅ · asset de sesión fuera del snapshot ✅ · pivote central y clipping anular por máscara ✅ |
| **QA Posición 7** (05-nov, técnica) | R8 clamp/paso ✅ (115⇒110 · 65⇒70 · 92.25⇒92.5 · legacy ⇒ 100 %) · escaneo polar R4 con tolerancia 0 estricta ✅ (tocar ≠ desbordar, píxel a radio exacto) · corona dentada y muesca cóncava cruzan R_ext/R_int ✅ (QA2) · barrido ≤ 25 ms ✅ · Auto forma cerrada ✅ (100 % / tope 110 % / banda exacta 92.5 % / dip estructural ⇒ null) · bbox degradado §6 conservador ✅ · textos banner/ficha EXACTOS ✅ · envelope de sesión fuera del snapshot ✅ |
| **Post-entrega pos 7** (05-nov, decisión del titular) | Botón **Auto retirado de la UI** (solo UI: `largestSafeScalePct` + sus 5 tests siguen en `lib/overflow` para pos 9/10) ✅ · **nitidez SVG corregida**: raster a resolución FINAL vía envoltorio de 1024² (SVG con width/height chicos — o sin ellos, 300×150 por defecto — nacía borrado por estirado del bitmap) ✅ · **sin refuerzo alfa ×1.8 en SVG** (conserva anti-aliasing nativo; refuerzo SOLO para PNG) ✅ · **anisotropía máxima** en la CanvasTexture del grabado (virola de perfil sin desenfoque de mipmap) ✅ · canvas de trabajo intacto 1024² (R8) ✅ |
| **QA Posición 8** (05-nov, técnica) | Ticket HMAC v1 ✅ (ida/vuelta, vigencia 5 min EXACTOS, firma con otro secreto ⇒ null, tamper de 1 byte ⇒ null, payload re-serializado ⇒ null, cotas de datos) ✅ · ruta `/api/exports/ticket`: 401 sin sesión (smoke), plan desde `users` con service-role, FREE ⇒ 402 PAYWALL_REQUIRED, pro/grace ⇒ 200 ticket (QA con sesión real + flip de plan en DB: corre el titular) · watermark cocida: doble pasada WebGL (pase principal manual priority 1 + autoClear off + clearDepth), banda diagonal semitransparente centrada SOLO plan free · bloqueo DOM `contextmenu`/`dragstart` + select-none SOLO demo · badge demo reactivo (0/1 → 1/1 al primer diseño) · desbloqueo realtime: plan-watcher ya refresca sin reload (el flip de plan lo demuestra) |
| **QA Posición 9** (06-nov, técnica) | Snapshot R1 inmutable ✅ (badge + Actualizar; hash f1 EXCLUYE capturedAt ⇒ ticket sobrevive Actualizar sin cambios) ✅ · formatos R2 EXACTOS ✅ (`123.0 mm` · banda auto 14.0 · `92%`/`92.5%` · `45°`/`45.5°` · faltante ⇒ `—`) · descriptores R3 sin auto-nombres ✅ · margen canónico R5 ✅ (`Seguro` / `con riesgo (excede X mm por fuera / excede Y mm hacia la boca)`) · wrapObservations R5 ✅ (≤2 líneas, `…` preserva palabra entera, palabra overlong sin seguir texto ⇒ sin elipsis) · R8 fallbacks + warns ✅ (NaN ⇒ `—`, modelo desconocido ⇒ Camionero) · hash estable ✅ (mismo contenido/reloj distinto ⇒ mismo hash; cambio de contenido/logo ⇒ otro) · currentOverflowCheck derivación única ✅ (== evaluateOverflow / bbox §6 conservador / null sin asset) · nomenclatura §5 EXACTA ✅ (`etiqueta-argenta-ficha-mate-imperial-20261103.png|pdf`, foto análoga) · build: motor three + pdf-lib en chunks separados ✅ |
| **QA Posición 10A** (06-nov, técnica) | Núcleo puro ✅ (R2: 6 chars/canónico/colisiones inyectadas · R4: fracción ×100 → % canónico, módulo 360, labels ≤40 truncado elegante · R5: 30 d + ≤5 d con prioridad aprobado>vencido>por_vencer · código `APROBADA-{VARIANTE}-{LINKID}` EXACTO de spec usuario · wa.me de aprobación nombra la opción y pelea los símbolos del E.164) ✅ · `buildPublicView` ✅ (re-arbitra contratos: presets VÁLIDOS `bronce`/`algarrobo`, diámetros saneados con hueco < corona, legacy 1:1 con `textureDataUrl` ⇒ variante A, jsonb basura ⇒ vista sin lanzar, ids inválidos/duplicados fuera) ✅ · 402 FREE server-side ✅ (plan desde `users` con service-role fail-closed en POST — decisión del cliente jamás paga) · aprobación pública ✅ (404 inexistente / 410 vencido / variante validada contra payload + INSERT con cliente anónimo ⇒ RLS `approvals_public_insert` + trigger `link_open_for_approval`; CTA registra ANTES de `wa.me` con backoff y wa.me garantizado con número válido) ✅ · Storage ✅ (textura PNG escalera ≤300 KB + original ≤10 MB + logo por versión, buckets `link-assets` público / `designs` privado) · visor ✅ (crossfade ≤300 ms por capas de la MISMA textura sin resetear cámara/giro/ritmo, 0.5 RPM pausable que reanuda al soltar, sin guías/medidas/marca de agua, descarga sin margen) · `/v` pública POR DISEÑO ✅ (fuera del redirect a `/auth`, con comentario deliberado). Smoke del 401 sin sesión en `POST /api/links` con curl + QA visual completa (publish PRO real, badge APROBADO, layout WhatsApp) ⇒ pendiente del titular con el diseño real. **Avance QA en vivo (06-nov):** tras `3782470`, `POST /api/links` ⇒ **200** (publish real, linkId `qo6khn`, registro QA con plan `pro`) y `GET /v/qo6khn` ⇒ **200** (visor público compila y sirve) — el circuito de publicación + visor quedó verificado end-to-end en dev |
| **QA Posición 10B** (06-nov, técnica) | Núcleo puro ✅ (32 tests: máquina R1/R4/R8/R9 — gracia 5 días corridos NO re-abrible desde el PRIMER rechazo, `resolvePlan` activa⇒pro / gracia viva⇒pro_grace / programada pre-`period_end`⇒pro / vencidas⇒free, ciclo anclado a 00:00 AR `America/Argentina/Buenos_Aires` con clamp a meses cortos —ancla 31 ⇒ 28 feb—, `freezePrice` SOLO alta/re-activación R4, `formatArs` es-AR con NBSP U+00A0 documentado) ✅ · webhook/firma ✅ (11 tests: manifiesto HMAC `id;request-id;ts` timing-safe con cualquier v1 vigente, data-id/ts/request-id/secreto retocados ⇒ false, piezas faltantes ⇒ fail-close, query legada `?topic=&id=` para curl QA) ✅ · dedupe R7 (`mp_payment_id` UNIQUE: re-envío ⇒ 200 `dedupe` sin insertar ni mutar) + compare-and-set (`WHERE status = current`; CAS perdido logea y queda a la reconciliación) ✅ · mutación autoritativa: `price_frozen` = monto DEL PAGO aprobado y `cycle_anchor` re-anclado SOLO en alta/re-activación + autoheal de fila `subscriptions` si el seed del checkout falló ✅ · dunning al-vuelo SIN pg_cron (decisión del titular): editor y perfil reconcilian el ciclo ANTES de leer `users.plan` — ventanas vencidas ⇒ `gracia_vencida` ⇒ FREE preservando proyectos/assets/links, drift MP (cancelled/paused no notificado) ⇒ `programada_cierre`, realineo del gating con `resolvePlan`; fallo suave con try/catch ✅ · Centro de Suscripción leído con la RLS DEL DUEÑO (historial estrictamente privado, §5) ✅ · paywall con paso "Confirmá tu email" (409 `EMAIL_NOT_VERIFIED`; Confirm email sigue OFF ⇒ el QA fuerza seed `email_confirmed_at = NULL`) y `checkout_intents` cero emails de abandono (R10) ✅ · build 19 rutas sin leaks server-only en bundles cliente ✅. QA del titular de punta a punta (sandbox MP + túnel + 0005) ⇒ pendiente, checklist en §10 |
| **QA 10B en vivo** (07-nov, sandbox MP) | Circuito de dinero COMPLETO con MP-truth (preapproals y pagos REALES del sandbox; MP nunca llamó `notification_url` ⇒ eventos reenviados a mano con la firma HMAC del manifiesto `id;request-id;ts;` — mismo circuito de los 11 tests de webhook). **QA1 alta protegida** ✅ (filas `023e7f86…`/`b344321a…` en `checkout_intents`, CERO emails de abandono R10; visual del modal queda al titular). **QA2 ida feliz** ✅ — preapproval `4a9bf222…` (plan `336d29cd…` 20.000 ARS/mes + card_token + payer comprador-test + `external_reference`=user del titular) ⇒ primer cobro approved `188361624478` (20.000) ⇒ evento ⇒ `payments` + `subscriptions{activa, price_frozen 20000, cycle_anchor 2026-11-07}` + `users.plan='pro'`; `receipt_url: null` — MP no lo trae en el GET (R6 permite null) · **QA3 dedupe** ✅ — re-envío del MISMO evento ⇒ 200 `{"dedupe":true}` sin mutar DB ni MP; **QA3.2** ✅ — pago approved `187300201985` dentro de `programada_cierre` ⇒ activa (R9) · **QA4 dunning** ✅ — rechazo REAL de MP `187299351371` (`cc_rejected_other_reason`; MP lo creó async tras el 401 del POST directo) ⇒ `gracia` + `grace_expires_at`=rechazo+5d exacto (2026-11-12T18:00Z) + plan `pro_grace` + fila payment; re-envío del mismo rejected ⇒ dedupe (la ventana NO re-abre — live); aprobado `188362068082` ⇒ restauración `activa` con grace null y `price_frozen` INTACTA (R4) · **QA5 salida limpia** ✅ — `PUT {status:cancelled}` + evento preapproval ⇒ `programada_cierre` con `period_end`=2026-12-07T03:00Z (= 12/07 00:00 AR, ancla día 7) y plan sigue `pro` SIN cobros (R9); `period_end` vencido sembrado como fixture ⇒ el reload de /perfil dispara el reconcile (FREE + paywall + proyectos/assets/links intactos). **Extra 403** ✅ live — webhook SIN firma ⇒ `403 FIRMA_INVALIDA`. **Desviaciones del modo TEST de MP** (documentado; 0 cambios de producto): suscripciones de test SOLO se crean como `plan + card_token_id + status:'authorized'` (planless-pending es prod-only ⇒ el route de la app NO cambió: correcto para prod); la tarjeta sandbox de la spec 5031…0604 falla Luhn al atarse (`CC_VAL_433`) ⇒ deck oficial APRO **5254 1336 7440 3564 / 123 / 11-30** (declinante: mismo número con cardholder `OTHE` / DNI 12345678); comprador-test creado vía API (`POST /users/test_user`); los pagos de MP no exponen `preapproval_id` ⇒ binding dinero→usuario SOLO via `external_reference` (el checkout de prod siembra `subscriptions.preapproval_id`; en QA se sembró a mano); el "2.º rechazo no re-abre" quedó en tests core (este sandbox entrega un único rejected); `pricing_config` UPDATE con service-role es RLS-bloqueado (`42501`) ⇒ el cambio de precio 25000 es línea SQL del titular. Preapproals extra de prueba canceladas via PUT (limpieza del panel) |
| Git | ✅ `21054e0` docs 10B (demo visual del titular: alta hospedada + binding post-alta inmutable) · `9b13e7f` docs 10B (titular consume la salida limpia + CTA en vivo — 502 honesto en test) · `d476cb3` docs 10B (QA en vivo con sandbox MP: evidencias QA1–QA5 + desviaciones) · `4136e36` fix 10B (el 400 de MP imprime las `cause` exactas) · `ab90418` fix 10B (`grace_expires_at` en la 0005 — schema del ciclo faltante) · `43e27cd` **posición 10B** (dunning al-vuelo: reconcile en editor + perfil con corte de ventanas y realineo de plan) · `04273e3` 10B paso 4 (Centro de Suscripción: tarjeta + historial con constancia + Portal MP) · `e56ca32` 10B paso 3 (webhook blindado `/api/webhooks/mercadopago` + mailer Resend) · `9c31f79` 10B paso 2 (Checkout Pro: wrapper REST MP + `POST /api/billing/checkout` + paywall con CTA real) · `8bf0d25` 10B paso 1 (núcleo puro de pagos + migración 0005 + envs MP/Resend) · `4f35790` fix 10A (aprobación pública sin RETURNING — select de anon revocado por diseño) · `3782470` fix 10A (grants service-role projects/links/link_approvals + log `[links ownership]`) · `7d81e73` **posición 10A** (enlace comercial compartible + Modo Cliente: variantes A/B/C del mismo diseño, publish inmutable versionado + Storage re-encodado, aprobación R6 ANTES de wa.me, visor `/v/[linkId]` con crossfade ≤300 ms) · `b385c00` 10A paso 3 (rutas API links + service-role — titular) · `676fefa` 10A paso 2 (identity/payload/estados + migración 0004 — titular) · `094e73b` **posición 9** (ficha: modal #quoteModal + PNG HD 2160 + PDF A4 + Foto HD + ticket verificar + registro QA) · `7c21277` **posición 8** (protección: watermark cocida + bloqueo DOM + ticket export 402/HMAC) · `141f094` post-entrega pos 7 (Auto fuera + nitidez SVG) · `ecd375b` docs · `b8cb203` **posición 7** (escala + desborde + espejo/Auto) · `f31fa32` **posición 6** (rotación) · `d5f376b` docs pos 5 · `940e69c` **posición 5** (color) · `feca766` **posición 4** (3 mallas + guías; extendida) · `e6ac05d` docs QA 04-nov · `9156361` docs pos 3 · `56483ef` grants 0910 + ruta logo honesta · `8a4329d` fix 0003 RLS autosave · `f54e359` fix R3/QA2 pos 3 · `db31c08` **posición 3** (12 archivos, 1.928 insertiones) · `e6ead5a` docs pos 2 · `3cf09d0` **posición 2** · `673d2af` docs pos 1 · `c38c4ed` · `e279f45` · `c8edbcf` · `1fa49e0` |

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
5. **Brand congelado por versión de link** (pos 10A ✅) — los cambios de perfil no mutan links vivos.
6. **El precio del plan NUNCA se hardcodea**: vive en `pricing_config` y se imprime desde el backend.
7. **Guías/watermark jamás salen en outputs** ni en el visor de cliente (contrato compartido entre specs).
8. **`location` nunca se imprime** y el **logo original jamás se persiste**: solo el re-encoded
   (≤512 px / thumb 144) sube al bucket privado (spec registro R2/R4).
9. **Sin datos de marca ⇒ neutralidad elegante**: los fallbacks de `resolveBranding()` son la ÚNICA
   implementación (título de plataforma, iniciales, CTA de código `APROBADA-…`) — las pantallas
   consumen la librería, nunca parchean degradaciones propias.

---

## 10. Próxima entrega (cuando se reinicie el trabajo)

**QA del titular de la posición 10B** — la caja está commiteada (tanda `8bf0d25` → `4136e36`:
núcleo puro + 0005 → Checkout Pro → webhook + mailer → Centro de Suscripción → dunning
al-vuelo → 2 fixes; hashes en la fila Git de §8). La verificación técnica pasó (285/285
tests, typecheck 0 con strict, build de 19 rutas con exit 0) y el **circuito REAL del sandbox
de Mercado Pago ya corrió (07-nov: QA1–QA5 con MP-truth; evidencias + desviaciones del modo
TEST en §8)**. Lo que queda es la pasada VISUAL del titular, con el estado DB preparado como
fixture de salida limpia (`programada_cierre` + `period_end` vencido), en orden:

1. **Base de datos** ✅ (07-nov) — `0005` aplicada y verificada por REST; el fix `ab90418`
   añadió `subscriptions.grace_expires_at` (leía 200 ⇒ schema del ciclo completo).
2. **Credenciales sandbox MP** ✅ (07-nov) — presentes en `.env`; descubrimiento clave: el
   `MP_ACCESS_TOKEN` es la cuenta TEST-VENDEDORA del app (`APP_USR…` con `tags:["test_user"]`)
   y en modo TEST las suscripciones SOLO nacen `plan + card_token + authorized` (§8).
3. **Túnel local** ✅ (07-nov) — ngrok activo; MP no lo llamó jamás (dropea `notification_url`
   en creaciones por plan) ⇒ los eventos se reenviaron a mano firmados con
   `MP_WEBHOOK_SECRET` (mismo circuito HMAC exo-probado en los tests del webhook).
4. **QA1 — alta protegida** ✅ (07-nov: filas en `checkout_intents`, CERO emails de
   abandono R10) — forzar `email_confirmed_at = NULL` ⇒ CTA del paywall ⇒ 409
   `EMAIL_NOT_VERIFIED` (paso "Confirmá tu email" con reenvío inline); confirmado el token de
   24 h, "verificar de nuevo" avanza al Checkout Pro. *(Visual del modal: al titular.)*
5. **QA2 — ida feliz** ✅ (07-nov en vivo: preapproval `4a9bf222…`, cobro approved
   `188361624478` de 20.000) — `users.plan='pro'` desde el evento, fila en `payments` con
   `price_frozen` = monto del pago y `cycle_anchor` = día de la primera aprobación;
   `receipt_url: null` (MP no lo trae — R6 permite). *(Visual del Centro de Suscripción y del
   broadcast Realtime: al titular.)* **Ida del CTA en vivo (07-nov)**: el titular clickeó el CTA
   del paywall tras la salida limpia — sesión ✓, email ✓, precio leído de `pricing_config` ✓
   (2× `GET /api/config/pricing 200`), fila `inactiva` ✓, intent auditado (`e7286839…`, R10) ✓
   — y MP devolvió el 400 pelado del modo TEST ⇒ la app tradujo a **502 honesto** ("MP no
   respondió") sin crash ni éxito falso; el route NO cambió (correcto para prod, §8).
6. **QA3 — webhook repetido** ✅ (07-nov en vivo) — re-envío del MISMO evento ⇒
   `200 {dedupe}` sin duplicar ni mutar (dedupe `mp_payment_id` + compare-and-set); y un pago
   aprobado dentro de `programada_cierre` vuelve a activa (QA3.2 live: `187300201985`).
7. **QA4 — dunning** ✅ (07-nov en vivo con rechazo REAL de MP `187299351371`) — ⇒ `gracia` +
   ventana = rechazo + 5 días EXACTO + email de aviso; pago DENTRO de la ventana ⇒ PRO
   instantáneo SIN re-congelar el precio (R4, live); segundo rechazo NO re-abre la ventana
   quedó en tests core (este sandbox entrega un único rejected — §8); ventana vencida ⇒ FREE
   preservando proyectos/assets/links: se demuestra al recargar /perfil con el fixture (punto
   de salida limpia, abajo).
8. **QA5 — grandfathering + salida limpia** — cancelación ✅ (07-nov en vivo: `PUT
   {cancelled}` + evento preapproval ⇒ `programada_cierre` hasta 12/07 00:00 AR con banner de
   fecha exacta y sin cobros extra; una pausa no notificada también cae al reconciliarse);
   webhook sin firma ⇒ 403 fail-close ✅ live. **Pendiente del titular**: la línea SQL del
   precio — `update pricing_config set amount=25000 where key='pro_monthly_ars';`
   (service-role quedó RLS-bloqueado `42501` por diseño) ⇒ `GET /api/config/pricing` = 25000
   y el paywall muestra 25000 SOLO a estados free mientras el suscriptor conserva el congelado
   (20000 con tag); opcional revert a 20000. **Salida limpia consumida ✅ (07-nov)**: al
   recargar `/perfil` el reconcile bajó la fila vencida a `inactiva` (`period_end` null,
   `price_frozen` y `cycle_anchor` preservados) con `users.plan='free'` — proyectos/assets/
   links intactos; la fila queda legible para el historial del Centro de Suscripción.
9. **Exploración visual MP (07-nov, titular)** ✅ — alta REAL en la página del plan hospedada
   por MP (Checkout Pro de suscripciones): comprador-test + tarjeta APRO ⇒ preapproval
   `1bfa10ce…` **authorized** con primer cobro de 20.000 acreditado (semáforo verde en
   `summarized`; el índice `/payments/search` del sandbox tenga lag — la verdad es la del
   preapproval) y retorno al taller con `?preapproval_id=…` en la `back_url` del plan.
   Confirmación extra del binding: `external_reference` es inmutable post-alta (PUT ⇒ 400) —
   el circuito del app NO se engancha con alta hospedada (correcto: el alta de prod nace CON
   la ref desde el route del app vía Checkout Pro). **Cancel desde el portal del comprador**
   ✅ (07-nov, titular): el mismo titular la dio de baja desde la gestión de MP del lado
   comprador ⇒ `status: cancelled` inmediato al minuto (el lado comprador del Portal es real;
   en prod este cancel llega por webhook y el drift/reconcile ya cubre el caso no-notificado).
   La suscripción queda viva para explorar
   la gestión del comprador en el portal de MP; el interstitial de ngrok (free) es solo el
   once-per-visitor del túnel, sin impacto de la app.

QA manual del webhook sin túnel también vale: `tests/unit/payments-webhook.test.ts` documenta
el manifiesto exacto `id:{dataId};request-id:{rid};ts:{ts};` para firmarlo a mano con
`MP_WEBHOOK_SECRET` y mandarlo como header `x-signature: ts=…,v1=…`. Verificado otra vez el
21-nov contra el server local con el secreto real del `.env`: firma válida ⇒ `200
{"received":true,"dedupe":true}` (pago ya registrado, sin mutaciones), sin firma ⇒ `403
FIRMA_INVALIDA`, firma falsa ⇒ `403`.

**Precio vigente (21-nov-2026)**: **ARS 36.799/mes**. Se aplica con
`supabase/migrations/0006_price_pro_36799.sql` (o la línea `update pricing_config set
amount=36799 where key='pro_monthly_ars';` en el SQL Editor). Las suscripciones ya dadas de
alta conservan su `price_frozen` (R4): el precio nuevo lo ven los estados FREE.

Arrastran (no bloquean, de 10A y anteriores): QA visual de escena/ficha/foto con el archivo
real del taller — repro `Naruto/svg_naruto/primero diseño de naruto y sasuke.svg` —, smoke 401
de `POST /api/links` con `curl.exe`, badge "APROBADO Opción B" + QA visual del crossfade del
visor con el flujo real de WhatsApp, y el QA 402/ticket con sesión real de pos 8/9.

**La salida a producción del ciclo tiene su spec propia (creada 07-nov)**:
`../simulador_Mates/spec_pagos_ida_a_produccion.md` — reglas P1–P10 (credenciales del negocio
con chequeo anti `test_user`, dominio canónico, webhook entregado por MP, migraciones + precio
final, cobro real de verificación, Resend, deploy, observabilidad y rollback) + checklist por
fases A–F con criterio de cierre cada una y DOD de go-live en §6.

Y después: nada más de plan — las 10 posiciones del `orden_de_implementacion.md` están
commiteadas (10B cierra el ciclo: `8bf0d25` → `4136e36`); queda iterar con feedback del taller
real.

---

## 11. Orden de lectura sugerido (para volver al proyecto en el futuro)

1. **Este archivo** — entender qué es, en qué punto estamos y por qué.
2. `../simulador_Mates/README.md` — contratos transversales (§5).
3. La spec de la posición que se vaya a trabajar (según `orden_de_implementacion.md`).
4. Código: `lib/permissions.ts` → `middleware.ts` → `app/` → `components/` (orden de dependencia).

> Regla práctica: si dos documentos parecen contradecirse, gana la spec citada como única fuente
> en `../simulador_Mates/README.md §5`. Todos los números comprometidos se cambian ALLÍ y se re-verifican
> los consumidores.
