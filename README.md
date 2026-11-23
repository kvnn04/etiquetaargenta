# Simulador Mates 3D — SaaS MVP

Simulador 3D para talleres de grabado láser: configuran el mate, lo comparten con su
cliente por enlace y cierran la venta. Implementación del paquete de especificaciones
`../simulador_Mates/` (9 specs + guía de stack + orden de construcción).

**Estado**: ✅ Posición 13 (segunda ola) — *Reembolsos y contracargos del Plan PRO* sobre la base 12/11/10B. **Posición 12 (23-nov-2026)**: `/terminos`, `/privacidad`, `/arrepentimiento`, `/baja` y `/baja/confirmar` son públicas (sin login, sin paywall); footer legal con los dos botones en `/auth`, `/editor`, `/perfil` y `/v/[linkId]`; formularios públicos con código `ARR/BAJA/PRIV-…`, rate limit, honeypot y validación de origen; baja con doble opt-in (token hasheado de 24 h, un solo uso y cola manual perezosa al vencer); aceptación obligatoria en el paywall con evidencia versionada (`legal_acceptances`) y gate server-side `409 LEGAL_NOT_ACCEPTED` / `409 LEGAL_VERSION_CHANGED`; emails de acuse/alerta y migración `0008_legal.sql`. Norma vigente: **Disposición 954/2025** (no las derogadas 424/2020 ni 316/2018), Ley 24.240 y Ley 25.326. **Base 10B**: *Mercado Pago: Pagos, Suscripción y Comprobantes del plan PRO* (cierra el plan original). **Checkout Pro real**: el CTA del paywall llama `POST /api/billing/checkout` (gates server-side en orden: sesión ⇒ 401 · `email_confirmed_at` vacío ⇒ 409 `EMAIL_NOT_VERIFIED` con paso "Confirmá tu email" inline en el modal — Confirm email sigue OFF en Supabase: la verificación real ocurre SOLO al pagar — · credenciales/precio `pro_monthly_ars` ⇒ 503 · suscripción viva ⇒ 409 race · aceptación legal versionada ⇒ evidencia + 503 si no se puede guardar · fila `checkout_intents` de auditoría, R10: **cero emails de abandono**) y redirige al `init_point` del preapproval (wrapper REST v1 propio con `X-Idempotency-Key`, sin SDK nuevo). **Migración `0005_subscriptions`**: `subscriptions` (ciclo R1 `inactiva→activa→gracia→activa|FREE` + `programada_cierre`; **grandfathering R4** — `price_frozen` SOLO en alta/re-activación, con el monto del pago aprobado y `cycle_anchor` anclado al día del primer pago en `America/Argentina/Buenos_Aires`), `payments` (`mp_payment_id` UNIQUE para dedupe + `receipt_url` = constancia MP, R6; la factura ARCA sigue a mano) y `checkout_intents` — escritura solo service-role, lecturas privadas por RLS del dueño, **grants inline** (lección 10A/0910). **Webhook blindado** `/api/webhooks/mercadopago`: firma HMAC contra el manifiesto oficial `id;request-id;ts` con `MP_WEBHOOK_SECRET` (inválida ⇒ **403** fail-close), pull del recurso real (el body jamás decide dinero), dedupe + compare-and-set (re-envío sin mutar nada), transiciones del núcleo puro y broadcast Realtime vía `users.plan`; **mailer Resend** con degradación honesta a log (recibo/gracia/cierre — lista cerrada de emails). **Dunning al-vuelo** (sin pg_cron): editor y perfil reconcilian el ciclo ANTES de leer el plan — gracia 5 días corridos desde el PRIMER rechazo (no re-abrible), ventana vencida ⇒ downgrade a FREE preservando proyectos/assets/links, drift de cancelaciones de MP y realineo del gating con `resolvePlan`. **Centro de Suscripción** en `/perfil`: badge por estado, precio congelado con tag, próximo cobro, historial con constancia y botón único al Portal de MP (R9: cancelación/tarjeta SOLO ahí). Sobre las 1–10A: auth, perfil/branding, catálogo+escena, medidas/guías, color PBR, rotación, escala/desborde, protección FREE, ficha técnica/PDF/HD y Enlace Comercial + Modo Cliente. Queda: QA del titular con sandbox MP (credenciales + 0005 + túnel — plan detallado en `PROYECTO.md` §10).
**Posición 11 — sync de pagos + "Verifico de nuevo" real (22–23-nov-2026)**: migración `0007_payment_sync.sql` (`subscriptions.last_checkout_at`/`last_synced_at`; `payments.applied_at` + claim de email + `source`; backfill de las filas nacidas en 10B). `/perfil` sincroniza al-vuelo con TTL 60 s (ciclo no activo) / 6 h (activo) y ventana anti-resurrección `last_checkout_at − 1 día`; el editor queda en modo local (sin búsqueda de pagos). `POST /api/billing/refresh` es el botón real (401/429/502/503/200, cooldown 20 s). Los pagos faltantes se aplican en orden cronológico con la MISMA máquina del webhook (`lib/payments/apply.ts`), se reparan filas con `applied_at IS NULL`, se adopta el preapproval solo si el local es NULL y el email tiene claim atómico (1 por pago, hasta 3 intentos). La UI muestra "Verifico de nuevo" siempre que no haya PRO, estados honestos y "Contactar soporte" (email/WhatsApp, SLA 24 h) tras 2 intentos.

**Posición 12 — legal y derechos del consumidor (23-nov-2026)**: las cuatro páginas públicas + la confirmación de baja no piden sesión y quedan fuera del middleware de auth; la identidad del proveedor sale de `LEGAL_ENTITY_*` (si falta un dato, se muestra visiblemente qué completar, nunca se inventa). Los formularios crean `legal_requests` con código legible y fecha AR, responden con acuse en pantalla + email y alertan a `LEGAL_EMAIL`; el rate limit es 1/email/5 min + 5/IP/hora con IP hasheada. La baja **no** cancela en el POST: manda un link de 24 h con token SHA-256 de un solo uso, valida que el email pertenezca a la cuenta y que el `preapproval` sea propio, y recién ahí usa la máquina R9 (`programada_cierre`, acceso hasta `period_end`). Si el link vence, la solicitud queda en cola manual sin marcar identidad y se puede reenviar conservando el código. El paywall exige un checkbox **desmarcado** y el server registra evidencia versionada (usuario, documento, versión, fecha, contexto, IP y user-agent) antes de crear el preapproval.

**Posición 13 — reembolsos y contracargos (23-nov-2026)**: el webhook y el sync reconocen `refunded`, `partially_refunded` y `charged_back` (topic de pagos) y el topic de contracargos (`chargeback` / `topic_chargebacks_wh`). El pull autoritativo (`GET /v1/payments/{id}` / `GET /v1/chargebacks/{id}`) actualiza `payments.status` + `refunded_amount` (acumulado, clampeado a `amount`) y registra cada novedad en `payment_adjustments` (append-only, dedupe por `kind + mp_source_id` o `(mp_payment_id, kind, occurred_at)`). Un reembolso/contracargo **total del ciclo vigente** pasa `subscriptions.status='revocada'`, `closure_reason='refund'|'chargeback'`, `closed_at`, `users.plan='free'` y cancela el preapproval viejo; un **parcial** mantiene el plan hasta el fin del ciclo; un **ciclo pasado** solo se audita. La carrera refund/approved la gana el reembolso (un `approved` posterior nunca activa PRO) y un reintento responde `200` sin mutar ni reenviar email. UI: badges `REEMBOLSADO`/`CONTRACARGO`, historial con monto original + devuelto y “Reactivar PRO” con checkout nuevo (`/editor?paywall=1`). Migración **`0009_refunds_chargebacks.sql`** aplicada el 23-nov-2026 y **QA de integración 12/12** contra Supabase TEST + MP (ver `docs/qa-posicion-13.md`); los pagos semilla resultaron `live_mode: true`, así que el fold se validó con eventos sintéticos y **no se movió dinero real**.

**362 tests** unitarios pasando en Vitest (+ **12/12** QA de integración), build de producción 30 rutas 100% verde y TypeScript strict 0 errores.
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
| Test unit | Vitest 4 (362 tests: matriz R2 + branding + catálogo + virola pos 4 + color pos 5 + diseño pos 6-7 + desborde pos 7 + ticket export pos 8 + ficha snapshot/textos pos 9 + links núcleo/visor pos 10A + **pagos core 32 + webhook/firma 11 pos 10B + sync/ventana/reparación/transporte 18 pos 11 + legal 25 pos 12 + reembolsos/contracargos 15 pos 13 + origin/back_url 6 pos 13** en `tests/unit/`) |
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
    perfil/          → PANEL DE PERFIL (posición 2): 5 campos + indicador 5×20 % + zona de peligro + CENTRO DE SUSCRIPCIÓN (10B/11/13: badge, precio congelado, historial con constancia y montos devueltos, Portal MP, sync al-vuelo, "Verifico de nuevo" real, `REEMBOLSADO`/`CONTRACARGO` y "Reactivar PRO") + derechos del consumidor y banner legal no bloqueante (pos 12)
    (legal)/         → POS 12: páginas públicas /terminos · /privacidad · /arrepentimiento · /baja · /baja/confirmar (sin login, sin paywall, con print CSS y metadatos)
    (editor)/editor/ → shell del editor con gating R2 (guard deleted_at; escena 3D real desde la posición 3); `?paywall=1` abre el checkout normal para "Reactivar PRO" (pos 13)
    api/
      config/pricing/ → GET pricing (patrón: backend como única fuente del precio)
      exports/        → POS 9: GET registro QA ?type=png|pdf (401 sin sesión · snippet {user, plan, artifact, at})
      exports/ticket/ → POS 8: POST ticket de export — plan authoritativo ⇒ FREE 402 PAYWALL / PRO ⇒ HMAC 5 min
      exports/ticket/verificar/ → POS 9: POST contra-verificación (HMAC timing-safe + TTL + hash ⇒ 403 TICKET_INVALIDO)
      profile/logo/   → POST/DELETE del logo (server revalida por magia de bytes)
      profile/delete/ → POST eliminar cuenta (soft + hard delete + signOut)
      auth/exit/      → GET signOut server + redirect con mensaje neutro
      links/          → POS 10A: POST publish (plan autoritativo ⇒ FREE 402 / inmutable versionado + Storage) · GET versiones+aggregados de aprobaciones · DELETE de una versión propia
      links/[id]/approvals/ → POS 10A: POST pública sin sesión (404/410 + RLS insert-only)
      billing/checkout/     → POS 10B/12/13: POST alta de suscripción (gates sesión → email → precio → viva (permite `revocada` y crea preapproval nuevo) → aceptación legal versionada + evidencia ⇒ preapproval MP + seed `subscriptions` inactiva + `last_checkout_at`)
      legal/                → POS 12: POST públicos /arrepentimiento · /baja · /baja/confirm · /privacidad (rate limit, honeypot, Origin, token de baja de 24 h)
      billing/refresh/      → POS 11: POST "Verifico de nuevo" real (sesión 401 · MP 503 · cooldown 429 · sync manual 200/502)
      webhooks/mercadopago/ → POS 10B/13: ÚNICO webhook de dinero (firma HMAC fail-close 403 · pull del recurso · dedupe `mp_payment_id` + CAS · emails legítimos R10; POS 13 suma refunded/charged_back y el topic de contracargos con pull de `chargeback` + `payment`; comparte `applyPayment`/`applyChargeback` con el sync)
    v/[linkId]/       → POS 10A: MODO CLIENTE (server service-role + páginas amables + /v público)
    setup/            → página amable si faltan env vars
  components/        → auth / profile / editor / studio / paywall / quote (pos 9) / links (pos 10A) / legal (pos 12) / session / ui
    links/           → variants-card.tsx (aviso: un solo diseño por enlace) · link-modal.tsx (publish+versiones+borrado) · client-viewer.tsx (Modo Cliente UI) · viewer-scene.tsx (escena 3D pública)
    legal/           → legal-footer.tsx (footer con los dos botones, client-safe) · legal-identity.tsx · legal-meta.tsx · legal-form-ui.tsx · withdrawal-form.tsx · baja-form.tsx · baja-confirm.tsx · privacy-form.tsx
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
    links/           → POS 10A: identity.ts (linkId R2 + colisiones) · payload.ts (schemaVersion 2 + risk R7 + linkDraft legacy) · states.ts (estados/vigencia + wa.me share/aprobación + código APROBADA) · asset-encode.ts (≤300 KB escalera PNG) · view-shape.ts (buildPublicView tolerante + legacy 1:1)
    payments/        → POS 10B/11/12/13 (sin SDK de MP; PURO el core): core.ts (máquina R1/R4/R8/R9 + `revocada` R11 + gracia 5 d corridos + ciclo anclado tz AR + formatos ARS + resolvePlan) · refunds.ts (POS 13 PURO: clamp/acumulado, estado autoritativo, ciclo vigente, impacto revoke/partial/audit, reverso) · mercadopago.ts (REST v1 preapproval/payments/chargebacks + search por external_reference + cancelPreapproval) · webhook.ts (firma HMAC manifiesto `id;request-id;ts` timing-safe + topics de contracargo) · mail.ts (Resend + degradación honesta a log + Idempotency-Key; POS 13: reembolso total/parcial, contracargo y alerta interna) · apply.ts (camino ÚNICO de pago/preapproval/refund/chargeback compartido webhook⇄sync⇄legal + claim de email) · sync.ts (TTL/cooldown, ventana R12.4, selección/orden/auditoría, refunds, preapproval, realineo) · reconcile.ts (dunning al-vuelo: ventanas vencidas + drift MP + realineo del plan; modos `local`/`sync`)
    legal/           → POS 12: config.ts (versiones, identidad por envs, metadata, precio) · links.ts (client-safe) · requests.ts (núcleo puro: códigos, validación, 10 días, rate limit, token 24 h, gate checkout, escape) · service.ts (service-role: DB/MP/email, baja con doble opt-in y cola manual perezosa) · mail.ts (4 emails + alerta interna) · http.ts (respuestas públicas)
    store/editor.ts  → zustand: estado del editor = snapshot de projects.state (+ linkDraft pos 10A)
    projects/        → persistence (restore/upsert + borrador local) · use-autosave (2 s + backoff)
    profile.ts       → completitud 5×20 % + copy dinámico
    encode-logo.ts   → pipeline del logo en CLIENTE (webp ≤512 + thumb 144)
    supabase/        → client / server / service (+ Storage branding + client anónimo para RLS de aprobaciones) / middleware
  supabase/
    migrations/  → esquema: 0001_auth_skeleton · 0002_profile_fields · 0003_projects_owner_default · 0004_shareable_links (links + link_approvals RLS pública + buckets) · 0005_subscriptions (ciclo de cobro: subscriptions + payments + checkout_intents, RLS owner select, grants inline) · 0006_price_pro_36799 (precio de lanzamiento ARS 36.799/mes) · 0007_payment_sync (POS 11: last_checkout_at/last_synced_at + applied_at/email_*/source + backfill 10B + índices) · 0008_legal (POS 12: legal_acceptances + legal_requests, RLS owner select en aceptaciones, service-role en solicitudes, índice de token y helper `legal_find_user_by_email`) · 0009_refunds_chargebacks (POS 13: estados de pago + refunded_amount/status_detail/updated_at, `revocada` + closure_reason/closed_at, payment_adjustments append-only con dedupe e RLS owner select) (idempotentes, sin DROP)
    ops/         → reparaciones re-ejecutables: 0901 backfill · 0910 grants · 0920 purga R8
  tests/         → Vitest (unit; 19 archivos): payments-core + payments-webhook (pos 10B) + payments-sync (pos 11) + **payments-refunds (pos 13: clamp/estado/ciclo/impacto/reverso)** · links-core + links-view (pos 10A) · quote-snapshot + quote-texts (pos 9) · export-ticket (pos 8) · overflow · design · color · virola · catalog · branding · matriz · **legal-core (pos 12: códigos, validación, 10 días, rate limit, token, gate checkout, escape)**
  three/         → motor 3D (pos 3): lathe-builder.ts · visual-skeleton.ts (+ three/README.md)
```

## Setup desde cero

1. **Paquetes**: `npm install` (Node ≥ 20; probado con Node 24 / npm 12).
2. **Supabase** → crear proyecto en [supabase.com] con región **sa-east-1** (latencia regional, §6 de la guía).
3. **Migraciones** (SQL Editor, en orden — todas idempotentes, sin DROP):
   1. `supabase/migrations/0001_auth_skeleton.sql` — users/projects/pricing + trigger + RLS.
   2. `supabase/migrations/0002_profile_fields.sql` — columnas de perfil (brand_name, logo_url,
      logo_thumb_url, whatsapp_e164, instagram_handle, location, deleted_at) + CHECKs.
   3. `supabase/migrations/0003_projects_owner_default.sql` — default de `user_id` en `projects`
      (logra que el INSERT del autosave tome la sesión vigente; posición 3).
      > El bucket de Storage `branding` **no se crea a mano**: la app lo crea sola en la primera
      > subida de logo (service role). Es **privado**: en la base solo quedan PATHS; las vistas
      > usan URLs firmadas de 1 h.
   4. `supabase/migrations/0004_shareable_links.sql` — `links` + `link_approvals` (RLS pública
      insert-only) + buckets `link-assets`/`designs` (posición 10A).
   5. `supabase/migrations/0005_subscriptions.sql` — ciclo de cobro `subscriptions`/`payments`/
      `checkout_intents` con RLS del dueño y grants inline (posición 10B).
   6. `supabase/migrations/0006_price_pro_36799.sql` — precio vigente del plan PRO
      (**ARS 36.799/mes**). Cambiar el precio es siempre una línea SQL, nunca una llamada
      del backend: `pricing_config` solo otorga `select` a `service_role`.
   7. `supabase/migrations/0007_payment_sync.sql` — sync de pagos (posición 11):
      `last_checkout_at`/`last_synced_at`, `applied_at`, claim de email y `source`; backfill
      de las filas de 10B para que el primer sync no re-aplique pagos históricos.
   8. `supabase/migrations/0008_legal.sql` — **posición 12**: `legal_acceptances`
      (evidencia versionada de términos/privacidad, RLS del dueño) + `legal_requests`
      (solicitudes públicas, solo service-role) + helper `legal_find_user_by_email`.
      ✅ **Aplicada 23-nov-2026** a mano en el SQL Editor (idempotente, sin `DROP`).
   9. `supabase/migrations/0009_refunds_chargebacks.sql` — **posición 13**:
      `payments` suma `refunded_amount`/`status_detail`/`updated_at` y los estados
      `refunded`/`partially_refunded`/`charged_back`; `subscriptions` suma `revocada`
      + `closure_reason`/`closed_at`; crea `payment_adjustments` (append-only, RLS
      del dueño para `select`, service-role para escribir). Los CHECK se reemplazan
      por definición en `pg_constraint` (idempotente, sin `DROP TABLE`).
      ✅ **Aplicada 23-nov-2026** a mano en el SQL Editor; verificada por el QA de
      integración (constraints `23514`/`23502` y RLS/grants).
4. **Dashboard (Auth)**
   - Providers → **Google**: activarlo (Client ID/Secret de Google Cloud) + Redirect URLs:
     `http://localhost:3000/auth/callback`.
   - **Confirm email: OFF** — es la regla "fricción cero" (R1 spec usuario); la verificación
     real ocurre solo al pagar (R7, token 24 h — posición 8–10).
   - Database → Replication → activar **public.users** (desbloqueo realtime sin reload, R6 spec_auth).
5. **Env**: `cp .env.local.example .env.local` y completar las 3 variables de Supabase.
   Para las posiciones 10B–11 (pagos + sync) añadir las llaves de Mercado Pago / Resend cuando
   se corra ese QA: `MP_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM` y `MP_PUBLIC_ORIGIN` (URL del túnel del webhook en dev).
   Para el bloque de soporte de `/perfil`: `NEXT_PUBLIC_SUPPORT_EMAIL` y
   `NEXT_PUBLIC_SUPPORT_WHATSAPP` (opcionales; sin ellos la UI lo indica).
   Para la **posición 12 (legal)**: `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_LEGAL_NAME`,
   `LEGAL_ENTITY_CUIT`, `LEGAL_ENTITY_TAX_CONDITION`, `LEGAL_ENTITY_ADDRESS`,
   `LEGAL_EMAIL`, `LEGAL_PHONE`, `LEGAL_WHATSAPP`, `LEGAL_HOURS`, `LEGAL_IP_SALT` y
   `NEXT_PUBLIC_SITE_URL` (ver `.env.local.example`). Sin identidad completa las
   páginas muestran qué falta y **no inventan** datos; `LEGAL_EMAIL` es obligatorio
   en producción.
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
| Vista previa HD de la ficha: cámara **cenital** (≈15°) apuntando a la corona para que el grabado se lea; Foto HD usa el mismo encuadre | ✅ `TOP_VIEW_OFFSET_MM` + fit por radio real del producto; el compositor escala el ráster de trabajo 1024² al canvas HD 2048² (sin eso el grabado caía en un cuadrante y la máscara lo recortaba); la cámara 3/4 del editor/visor queda para la escena interactiva |
| Export con ticket server-side (R7): FREE ⇒ 402 + Paywall, PRO ⇒ descarga; ticket 5 min ligado al hash; verificar antes de adjuntar | ✅ `ensureVerifiedTicket` (`export-flow.ts`): `/ticket` → `/ticket/verificar` (403 TICKET_INVALIDO) + UNA re-emisión — el candado 🔒 de UI es decorativo, la decisión la toma el server |
| Fallbacks (R8): modelo desconocido ⇒ "Mate Camionero", escala/rotación ausentes ⇒ 100 %/0°, datos inválidos ⇒ `—` + aviso en consola | ✅ `formatModeloCard` + `vigente()` con `console.warn` (testeado) |
| Confirmación de desborde ANTES de exportar con CTA EXACTOS "Exportar de todas formas" / "Volver a ajustar" (Ficha Y Foto HD) | ✅ panel interno del modal (`overflowBannerText` pos 7) + mini-diálogo Promise-based en la shell |
| Foto HD: render solo, misma infra de ticket+confirmación, sin grilla | ✅ `components/quote/foto-hd.ts` — 2560 px lado (escalado a 2160 exactos si excede 5 MB) |
| "Sin diseño cargado" = sin archivo en slot de sesión: Grabado placeholder, Producto/Acabados imprimen igual (decisión del titular); el modal lo ofrece a FREE también | ✅ `grabadoSinDiseno` ⇒ tarjetas con placeholder; server decide via 402 |
| Registro QA de exports: consola del server `{user, plan, artifact, at}` (sin tablas nuevas) | ✅ `GET /api/exports?type=png|pdf` + `POST /api/exports/ticket/verificar` (401/400/403/200) |
| Nomenclatura §5: `{taller}-ficha-mate-{model}-{aaaammdd}.png\|pdf` y `{taller}-foto-mate-{model}-{aaaammdd}.png` | ✅ `slugTaller` + `formatFileDate` en `texts.ts` (testeado con el ejemplo exacto de la spec) |
| La escena y la ficha comparten pipeline del grabado (un solo motor) | ✅ `composeEngravingCanvas` extraída a `lib/compose-engraving.ts` — studio-scene y ficha-render la importan |
| Fila de acciones §4: `[Descargar PNG]`, `[Descargar PDF]`, `[Generar Enlace Comercial]`, `[Enviar por WhatsApp]` (esta última vía módulo de enlaces) | ✅ `quote-modal.tsx` — «Generar Enlace» abre el modal de versiones SOBRE la Ficha; «Enviar por WhatsApp» comparte el enlace vigente con el mensaje EXACTO (`whatsappShareHref`); sin enlace publica primero; el share usa `wa.me/?text=` con selector de contactos (el E.164 del Perfil es solo destino de la aprobación) |

## ¿Qué quedó de la posición 10A? (según `spec_ficha_comercial_interactiva_shareable_link.md`)

| Requisito | Estado |
| :--- | :--- |
| Links versionados inmutables (R1): cada publish crea `linkId` nuevo, jamás UPDATE de payload; historial con agregados de aprobaciones | ✅ tabla `links` insert-only (`0004`), `POST /api/links` con `version=max+1`, `GET /api/links?projectId=` para el panel, `DELETE /api/links/{id}` (ownership server-side, cascade de aprobaciones + limpieza de `link-assets/{id}`) |
| Cantidad de enlaces por cuenta | **Sin tope duro**: un PRO publica todas las versiones que quiera (cada publish es un `linkId` nuevo). El panel lista hasta **100 versiones por proyecto** (las más nuevas primero); FREE no puede publicar (402). Cada versión vence a los 30 días, pero la fila sigue existiendo hasta que se elimina |
| `linkId` 6 chars `[a-z0-9]` (R2) canónico case-insensitive con reintentos de colisión; URL `/v/{id}` desde el origin del request | ✅ `lib/links/identity.ts` (`generateUniqueLinkId` inyectable, 23 tests) |
| Payload `schemaVersion 2` (R4): labels ≤40 truncado elegante, escala %⇒fracción 0–1.10 3 dec, rotación módulo 360, espejo; compat legacy 1:1 | ✅ `lib/links/payload.ts` + `buildPublicView` (`view-shape.ts`) re-arbitra todo en el visor (10 tests) |
| Assets re-encodados (R3): ≤1024²/≤300 KB por diseño en URLs de larga vida; `mateConfig` construido SERVER-SIDE desde `projects.state` | ✅ PNG escalera 1024/768/512 (`asset-encode.ts`, alpha intacto) → `link-assets/{id}/design.ext` público + original ≤10 MB → `designs/{user}/{project}` privado + logo del taller copiado POR VERSIÓN (`{id}/logo.png`, degrada a iniciales si falla) |
| Vigencia 30 días + "por vencer" ≤5 días (R5); estados del editor con prioridad aprobado>vencido>por_vencer>vigente | ✅ `lib/links/states.ts` (`linkEditionState`/`editionBadgeText`) + badge en el modal de versiones |
| Publicación con desborde documentado (R7): confirmación por variante + `risk` congelado INTERNO (el cliente jamás lo ve) | ✅ `currentOverflowCheck` por `scalePct` de cada variante + mini-diálogo de la shell reutilizado con CTAs "Publicar de todas formas"/"Volver a ajustar" + `LinkVariantRisk` en el payload |
| Paywall server-side (R8): FREE ⇒ 402 `links.generate` + Paywall; abrir/ver/aprobar público SIN sesión | ✅ plan desde `users` con service-role (fail-closed) en POST; middleware: `/v` deliberadamente fuera del redirect a /auth |
| Aprobación registrada ANTES de abrir WhatsApp (R6), acumulable, badge "APROBADO Opción B" | ✅ `POST /api/links/[id]/approvals` (404 inexistente / 410 vencido / variante validada contra el payload) + INSERT con cliente ANÓNIMO ⇒ la DB (`approvals_public_insert` + `link_open_for_approval`) es la última palabra; texto de WhatsApp nombra la opción EXACTA |
| Export del panel completo: Copiar Enlace / Enviar por WhatsApp con mensaje pre-armado EXACTO / vence el DD/AA / eliminar una versión propia | ✅ `link-modal.tsx` (draft+versiones+resultado; share `wa.me/?text=` SIN destinatario — WhatsApp abre el selector de contactos y no depende del número del Perfil; borrado con confirmación inline) |
| Decisión nov-2026: **un solo diseño por enlace** (A/B/C desactivadas) | ✅ tarjeta `variants-card.tsx` con el aviso "Solo se puede enviar un diseño por ahora"; `buildPublishVariant()` publica el diseño vigente como `A` y `POST /api/links` exige exactamente 1 variante; los links viejos con A/B/C se siguen leyendo |
| Borrador de variantes persiste en `projects.state.linkDraft` (se conserva para una futura reactivación; la tarjeta ya no lo edita) | ✅ `StoredVariantRow`/`normalizeVariantRows` (`payload.ts`) + `setLinkDraft` en el store + normalizador jsonb |
| Modo Cliente §4: top bar marca + "Vista Previa Oficial", giro 0.5 RPM pausable por el dedo, zoom/pinche, selector A/B/C (solo links legacy) + acordeón (Modelo/Virola mm/Cuerpo) + CTA verde full-width | ✅ `client-viewer.tsx` + `viewer-scene.tsx` (misma librería 3D del editor, SIN guías/medidas/watermark; crossfade ≤300 ms por capas de la textura — cámara y ritmo del giro jamás se resetean; el selector se oculta cuando el payload trae un solo diseño) |
| Páginas amables §6: inexistente/vencido/no disponible; variante con asset caído queda deshabilitada y las demás siguen | ✅ `app/v/[linkId]/page.tsx` (service-role, expiración ANTES de servir contenido) + `not-found.tsx` + gating por `assets` fallidos en el visor |
| Fallback sin WhatsApp (spec usuario R5): código `APROBADA-{VARIANTE}-{LINKID}` copiable + "Ponete en contacto con tu vendedor…" | ✅ `approvalCode()` + panel del código en el visor (el evento IGUAL registra, R6); con número `wa.me` directo tras el POST (reintentos con backoff en red rota) |
| linkId vigente ligado al DNA de la ficha (PASSTHROUGH de pos 9) | ✅ la shell consulta el link activo al abrir `#quoteModal` y lo pasa a `captureFichaSnapshot.linkId`; si el GET resuelve después del open, la Ficha recaptura el snapshot y reusa ese enlace en PDF y WhatsApp |

## ¿Qué quedó de la posición 12? (según `spec_paginas_legales.md`)

| Requisito | Estado |
| :--- | :--- |
| **R13.1** Norma vigente (Disposición 954/2025, no 424/2020 ni 316/2018) + identidad, versión y fecha | ✅ textos y metadata en `/terminos` y `/privacidad`; identidad desde `LEGAL_ENTITY_*` con aviso visible si falta un dato |
| **R13.2** Botones a simple vista en `/auth`, `/editor`, `/perfil` y `/v/[linkId]` | ✅ `LegalFooter` (variant `prominent` en auth, `compact` en editor/perfil/visor) con los dos botones outlined y links a Términos/Privacidad/Defensa del Consumidor |
| **R13.3** Sin registro, login, teléfono obligatorio ni WhatsApp | ✅ formularios públicos; el único paso extra es el doble opt-in por email de la baja (Q7) |
| **R13.4** Código único y acuse dentro de 24 h | ✅ `ARR/BAJA/PRIV-YYYYMMDD-XXXX` server-side, visible en pantalla + email; alerta interna a `LEGAL_EMAIL` |
| **R13.5** Arrepentimiento 10 días corridos, reembolso y baja | ✅ validación en calendario AR, se recibe igual fuera de plazo, acuse con plazo/reembolso/24 h |
| **R13.6** Baja con doble opt-in y acceso hasta `period_end` | ✅ POST no cancela; token SHA-256 de 24 h de un solo uso; verifica email de la cuenta y `external_reference` del preapproval; usa `applyPreapproval` (R9) con `suppressEmail`; vencido ⇒ cola manual sin `confirmed_at` y reenvío con el mismo código |
| **R13.7/R13.8** Checkout con checkbox + evidencia versionada | ✅ checkbox desmarcado y CTA deshabilitado; server valida `legalAccepted` + versiones; inserta `terms` y `privacy` (usuario, email, versión, fecha, contexto, IP, user-agent) **antes** del preapproval; fail-closed `503 EVIDENCIA_NO_DISPONIBLE` |
| **R13.9/R13.10** Privacidad y derechos de datos | ✅ encargados, transferencias, retención, seguridad, cookies, menores y AAIP; formulario público con código y plazo de 5 días hábiles |
| **R13.11** Precio final claro | ✅ leído de `pricing_config` en las páginas server (`readLegalPrice`), sin hardcodear; leyenda “impuestos incluidos” |
| **R13.12** Sin dark patterns | ✅ checkbox vacío, sin consentimiento premarcado, links legales visibles y baja sin llamadas ni justificación |
| **R13.13** Versionado y re-aceptación | ✅ `LEGAL_VERSIONS` en `lib/legal/config.ts`; cambio de versión ⇒ `409 LEGAL_VERSION_CHANGED` en el próximo checkout; banner no bloqueante en `/perfil`; las versiones viejas no se borran |
| **R13.14** Atención al consumidor | ✅ email/teléfono/WhatsApp y horario configurables (`LEGAL_HOURS`, default 9–18 = ≥8 h/día hábil), área responsable y canales en las páginas |
| **R13.15** Retención | ✅ plazos publicados (solicitudes/aceptaciones 5 años; logs técnicos 90 días; cuenta 30 días de restauración); la purga operativa queda como tarea del titular |
| **R13.16** Español, legible, imprimible, teclado y contraste | ✅ textos rioplatenses, ancho ≤ 75 caracteres, `print` CSS, labels, foco visible y `aria-live` en éxitos |
| **§5** Migración | ✅ `supabase/migrations/0008_legal.sql` (idempotente, sin DROP; **aplicar a mano** — no hay `DATABASE_URL`) |
| **§6** Seguridad | ✅ rate limit 1/email/5 min + 5/IP/hora con IP hasheada, honeypot, Origin/Referer, escape de HTML, service-role solo server-side y sin policies públicas en `legal_requests` |
| **Emails** | ✅ acuse de arrepentimiento, link de baja, baja efectivizada y acuse de datos + alerta interna; `sendMail` fail-soft (la solicitud se guarda aunque Resend falle) |

**Decisiones Q1–Q7 aplicadas:** identidad por envs con fallback visible; jurisdicción del
domicilio del consumidor y ley argentina; precio final ARS con impuestos incluidos y
comisión absorbida por la plataforma; reembolso del 100 % dentro de los 10 días aunque
el servicio se haya usado (también renovaciones); checkbox obligatorio en checkout con
evidencia de IP/user-agent (sin checkbox en el registro); re-aceptación solo antes del
próximo checkout con banner no bloqueante; baja con doble opt-in y SLA 24 h / 5 días
hábiles. **Desviación declarada:** el rate limit responde `429` genérico sin devolver
el código existente, para no permitir enumeración de emails (la spec §6 prioriza no
revelar si el email existe).

## ¿Qué quedó de la posición 13? (según `spec_reembolsos_y_contracargos.md`)

| Requisito | Estado |
| :--- | :--- |
| **R11.1** Verdad desde MP: el webhook solo dispara; el dinero sale de `GET /v1/payments/{id}` y `GET /v1/chargebacks/{id}` | ✅ `mercadopago.ts` (`getChargeback`, `transaction_amount_refunded`, `refunds`) + `route.ts` con pull antes de mutar |
| **R11.2** Estados `refunded`/`partially_refunded`/`charged_back` + `refunded_amount` acumulado y `status_detail` | ✅ `core.ts` + `refunds.ts` (clamp a `amount`, `approved` con devolución ⇒ parcial/total) + migración `0009` |
| **R11.3** Ciclo vigente: solo el último pago que financió el ciclo afecta el plan; un ciclo pasado se audita | ✅ `isCurrentCyclePayment` + `lastFunding` (`approved`/`partially_refunded` por `occurred_at DESC`); sin pago aprobado ⇒ solo auditoría (§3.3.5) |
| **R11.4/R11.6** Total/contracargo ⇒ `revocada`, `free`, `closure_reason`, `closed_at`; preapproval cancelado (Q6) | ✅ `transitionSubscription({kind:'reembolso_total'|'contracargo'})` + CAS de `subscriptions`/`users` + `cancelPreapproval`; fallo de MP ⇒ alerta al titular sin loop |
| **R11.5/Q2** Parcial ⇒ `partially_refunded` + `refunded_amount`; el plan sigue hasta el fin del ciclo | ✅ `decideRefundImpact` ⇒ `partial_keep`; banner “Registramos un reembolso parcial…” en el Centro |
| **R11.7** Idempotencia: CAS por estado, dedupe del pago, `payment_adjustments` append-only y dedupe por `kind + mp_source_id` / `(mp_payment_id, kind, occurred_at)` | ✅ `insertAdjustment` (23505 ⇒ no-op) + `mergeRefundStatus` monótono + `applied_at`; reintento ⇒ `200` sin email |
| **R11.8** El preapproval viejo no se reutiliza; “Reactivar PRO” crea checkout nuevo | ✅ checkout permite `revocada`, cancela el preapproval viejo si MP aún lo tiene vivo y siembra uno nuevo; `/editor?paywall=1` abre el paywall normal |
| **R11.9** Emails `reembolso_total`, `reembolso_parcial`, `contracargo` + alerta interna; uno por transición, sin prometer plazos del banco | ✅ `mail.ts` (HTML sin datos de tarjeta) + barrera `payment_adjustments`; `sendMail` fail-soft |
| **R11.10** Historial conserva el pago original + monto devuelto; `price_frozen`/`cycle_anchor` intactos | ✅ `PaymentRowView.refundedAmount` + fila original con badge y “devuelto $…” (no se borra ni reescribe el cobro) |
| **Carrera refund/approved (§6/QA5)** | ✅ el reembolso inserta `refunded` + `applied_at`; un `approved` posterior cae en `refund_wins`/`already_applied` y **nunca** activa PRO |
| **Aislamiento (§6)** | ✅ `external_reference` debe ser el `user_id`; una fila `mp_payment_id` de otro usuario ⇒ `payment_owner_mismatch` con log y cero mutaciones |
| **UI (§4)** | ✅ badges `REEMBOLSADO`/`CONTRACARGO`, mensajes exactos, historial con original+devuelto, “Reactivar PRO” (refund) / “Contactar soporte” + Portal MP (chargeback) |
| **Migración (§5)** | ✅ `supabase/migrations/0009_refunds_chargebacks.sql` (idempotente, sin DROP; **aplicada 23-nov-2026**) |
| **Tests** | ✅ `payments-refunds.test.ts` (15) + `http-origin.test.ts` (6, `back_url`/loopback) + whitelist/topics/sync ampliados + **QA de integración 12/12** (`docs/qa-posicion-13.md`) |

**Q1–Q7 (v0.2) resueltas por defecto:** Q1 total corta el acceso al instante; Q2 parcial
mantiene el plan hasta el fin del ciclo; Q3 ciclo pasado solo auditoría; Q4 contracargo
suspende sin gracia; Q5 reverso/ganado queda FREE con reactivación manual y registro
`reversal`; Q6 se cancela el preapproval al revocar; Q7 email al taller + alerta interna a
`LEGAL_EMAIL` (fallback `EMAIL_FROM`), sin plazos de acreditación. **Extensión declarada
(Q6):** el preapproval también se cancela cuando el cierre es por **contracargo**, no solo
por reembolso total (la spec solo lo exige para el total). **Desviación declarada:** un
reembolso de un ciclo pasado no manda email al taller (solo alerta interna), porque el
plan no cambia; el spec §4 describe el email del cambio de estado, no el de auditoría.

## Scripts

```bash
npm run dev         # editor + API
npm run build       # build de producción (typecheck incluido)
npm run typecheck   # tsc --noEmit
npm run test        # Vitest unitario (matriz R2 + branding + catálogo + virola + color + diseño + desborde + ticket export + ficha snapshot/textos + links + pagos + sync + legal + reembolsos, 362 tests)
npm run test:qa     # QA de integración (Supabase TEST + MP TEST + Next dev; requiere QA_ALLOW_MUTATIONS=1)
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
10. ✅ **10A — Enlace Comercial compartible + Modo Cliente** — links inmutables versionados + `linkId` al DNA de la ficha + `/v/[linkId]` público, commiteada (`7d81e73`). **Ajuste nov-2026**: publish de UN solo diseño (A/B/C desactivadas, legacy sigue visible) + borrado de versiones propias con confirmación
11. ✅ **10B — Mercado Pago: pagos, suscripción y comprobantes** — Checkout Pro + `price_frozen` grandfathering + webhook HMAC con dedupe + dunning al-vuelo + Centro de Suscripción, commiteada (`43e27cd`, 06-nov; QA del titular con sandbox pendiente — plan en `PROYECTO.md` §10)
12. ✅ **11 — Sync de pagos + "Verifico de nuevo" real** (segunda ola) — búsqueda por `external_reference`, reparación idempotente, ventana anti-resurrección, preapproval, email único y endpoint manual con cooldown; migración `0007` + 18 tests (22–23-nov, incluye la regresión del `sort` de `/preapproval/search`)
13. ✅ **12 — Páginas legales, aceptación y derechos del consumidor** (segunda ola) — `/terminos`, `/privacidad`, `/arrepentimiento`, `/baja` y `/baja/confirmar`; footer legal en auth/editor/perfil/visor; baja con doble opt-in y cola manual; evidencia versionada en checkout; emails y alertas; migración `0008` + 25 tests (23-nov; `0008` aplicada 23-nov). **Antes del go-live:** completar identidad `LEGAL_ENTITY_*` y revisión legal firmada
14. ✅ **13 — Reembolsos y contracargos del Plan PRO** (segunda ola) — `refunded`/`partially_refunded`/`charged_back` + topic de contracargos, `payment_adjustments` append-only, `revocada`/`free` en el ciclo vigente, parcial sin bajar el plan, carrera refund/approved, preapproval cancelado, emails y UI del Centro; migración `0009` + 15 tests (23-nov). **QA 23-nov:** `0009` aplicada; **12/12** escenarios contra Supabase TEST + MP TEST (reembolsos/contracargos sintéticos porque los pagos semilla son `live_mode: true`; ver `docs/qa-posicion-13.md`). **Antes del go-live:** un pago nuevo `live_mode:false` para el end-to-end real

Cada bloque de trabajo se abre leyendo la spec fuente: los números (latencias,
límites, constantes) solo se cambian allí y de ahí se re-verifican los consumidores.
