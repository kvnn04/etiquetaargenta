# QA de integración — Posición 13 (reembolsos y contracargos)

**Fecha:** 23-nov-2026 · **Entorno:** Supabase TEST + Mercado Pago TEST + Next dev local
**Resultado:** ✅ **12/12 escenarios QA** y **366/366 tests unitarios**; `tsc --noEmit` sin errores.

Este documento registra la corrida real del QA de la posición 13 contra la base TEST y la
cuenta de Mercado Pago configurada en `.env`. No se usaron mocks de base de datos: el fold
corre contra Supabase y los pulls/checkout/preapprovals contra la API de MP.

---

## 1. Cómo se corre

```powershell
# Requiere el .env del proyecto y el puerto 3100 libre.
$env:QA_ALLOW_MUTATIONS='1'
npm run test:qa
```

- `vitest.qa.config.ts` corre solo `tests/qa/**/*.qa.test.ts`, en secuencia y con timeout de 240 s.
- `tests/qa/setup.ts` exige `QA_ALLOW_MUTATIONS=1`: el QA **muta** la base TEST.
- El runner levanta `next dev` en `127.0.0.1:3100` y lo baja al final.
- `npm test` excluye `tests/qa/**` (los tests unitarios no tocan Supabase/MP).

### Seguridad aplicada

Los 4 pagos semilla (`187300201985`, `188362068082`, `188361624478`, `187299351371`) son
**`live_mode: true`**: son cobros reales, aunque la cuenta tenga tag `test_user`. El QA
**no llama al endpoint de refunds de MP**. Los reembolsos se ejercitan con eventos
sintéticos que replican exactamente el payload de `GET /v1/payments` (`status`,
`transaction_amount_refunded`, `refunds[]`); los contracargos y reversos también son
sintéticos porque MP no permite crearlos por API. Los pulls `GET`, la cancelación de
preapprovals y el checkout son reales.

Al terminar, `afterAll` restaura `payments` desde MP (fuente autoritativa), borra los
`payment_adjustments` sintéticos, cancela los preapprovals creados y elimina el usuario QA
junto con su evidencia legal. La cuenta queda consistente con MP.

---

## 2. Resultado por escenario

| # | Escenario | Resultado | Evidencia principal |
| :-- | :--- | :--- | :--- |
| 0009 | Constraints de estados, montos y dedupe | ✅ | `payments.status`/`subscriptions.status`/`closure_reason` rechazan `bogus` con `23514`; los 5 estados de pago y los 5 de suscripción se aceptan; `refunded_amount NULL` ⇒ `23502`; dedupe `(kind, mp_source_id)` y `(mp_payment_id, kind, occurred_at)` ⇒ `23505` |
| 1 | Reembolso **parcial** del ciclo vigente | ✅ | `applyPayment` ⇒ `adjusted`/`refund`; pago `partially_refunded` + `refunded_amount=5000`; plan PRO y suscripción `activa`; 1 adjustment; email al cliente + alerta `partial_keep`; `/perfil` muestra `REEMBOLSO PARCIAL` y “Tu plan sigue activo hasta el fin del ciclo” |
| 2 | Reembolso **total de un ciclo pasado** | ✅ | Pago `refunded` + `refunded_amount=20000`; plan/suscripción intactos; `reason='refund_audit_only'`; 0 emails al cliente; 1 alerta interna con `audit` y “ciclo pasado” |
| 3 | Reembolso **total del ciclo vigente** | ✅ | `revocada` + `closure_reason='refund'` + `closed_at`; `users.plan='free'`; preapproval real cancelado en MP; adjustments suman 20000; email de reembolso total + alerta `revoke`; `/perfil` muestra `REEMBOLSADO`, “Reactivar PRO” y `href="/editor?paywall=1"` |
| 4 | **Contracargo** + reverso/ganado | ✅ | `charged_back` + `refunded_amount=20000`; `revocada`/`chargeback` sin gracia; preapproval cancelado; email de contracargo; `/perfil` muestra `CONTRACARGO`, “Contactar soporte” y **no** “Reactivar PRO”; reverso `won` ⇒ adjustment `reversal`, alerta `manual_reactivation`, plan sigue FREE; reintento ⇒ `already_applied`, sin duplicados ni emails |
| 5 | **Carrera refund/approved** | ✅ | Un `approved` posterior al reembolso no inserta/repair ni reactiva: suscripción sigue `revocada` y plan `free`; reintento del refund total ⇒ `already_applied`, sin adjustments ni emails nuevos |
| 6 | **Evento de otro usuario** | ✅ | `external_reference` ajeno ⇒ `skipped`/`user_mismatch`; fila `mp_payment_id` de otro usuario ⇒ `payment_owner_mismatch`; la fila ajena queda `approved` (cero mutaciones) |
| 7 | **Q6:** MP no cancela el preapproval | ✅ | Igual revoca (`revocada`/`refund`, plan `free`); alerta interna “no se pudo cancelar” con el id y “revisar a mano”; email al cliente; sin loop de reintentos |
| 8 | **Reactivar PRO** | ✅ | Checkout real `201` con preapproval nuevo; el viejo queda `cancelled` en MP; suscripción sembrada `inactiva`, `closure_reason`/`closed_at` limpios; evidencia `terms`+`privacy` 1.0 y 1 `checkout_intent` |
| 9 | **Webhook HTTP** | ✅ | Firma válida + pago ya aplicado ⇒ `200 {dedupe:true}`; firma inválida ⇒ `403`; topic `chargeback` con id inexistente ⇒ `502` (pull falla); topic ignorado ⇒ `200`; evento sin `data.id` ⇒ `403` |
| 10 | **RLS/grants** de `payment_adjustments` | ✅ | `anon` no lee; el dueño lee solo sus filas; INSERT/UPDATE/DELETE del dueño fallan; `service_role` lee y escribe; `payments`/`subscriptions` del dueño siguen legibles y `anon` no |
| 11 | **Resend real** | ✅ | `sendMail` ⇒ `sent:true`, `note:"ok"` con `EMAIL_FROM=Taller Mates <onboarding@resend.dev>` a `kherrera@pioix.edu.ar` |

**Corrida final:** `Test Files 1 passed (1) · Tests 12 passed (12)` en ~137 s.

---

## 3. Bugs reales encontrados y corregidos durante el QA

1. **`back_url` de MP debe ser string** — el checkout mandaba un objeto; MP respondía
   `400 "back_url is required"`. Se envía `backUrls.success` (string).
2. **`start_date` no puede ser pasada** — MP respondía `400 "cannot be a past date"`.
   `createPreapproval` normaliza con `preapprovalStartDateIso()` (+5 min,
   `PREAPPROVAL_START_MARGIN_MS`).
3. **`localhost` no es un `back_url` válido para MP** — Next dev expone
   `nextUrl.origin = http://localhost:3100` aunque escuche en `127.0.0.1`; MP rechaza
   `localhost` (`400 "must be a valid URL"`). Se agregó `publicRequestOrigin()`
   (`lib/http/origin.ts`): usa el `Host` real, respeta `x-forwarded-proto` y normaliza
   loopback a `127.0.0.1`. Cubierto por 6 tests unitarios.
4. **El QA no debe reembolsar los pagos semilla** — son `live_mode: true`. Se reemplazó
   `mpRefund()` por eventos sintéticos y `afterAll` restaura `payments` desde MP.
5. **Huérfanos de evidencia legal** — `legal_acceptances.user_id` es `on delete set null`
   (correcto para evidencia real); el QA ahora borra las aceptaciones del usuario efímero
   antes de borrarlo.

---

## 4. Estado final de la cuenta TEST (verificado)

| Elemento | Estado |
| :--- | :--- |
| `users` | 3 usuarios; `kherrera@pioix.edu.ar` (`ced3fa8c-…`) con `plan='pro'` |
| `subscriptions` | 0 filas (se restauró la foto inicial) |
| `payments` | 4 filas: 3 `approved` + 1 `rejected`; `refunded_amount=0`; `occurred_at` = `date_created` real de MP (07-nov-2026) |
| `payment_adjustments` | 0 filas (los adjustments del QA eran sintéticos) |
| `legal_acceptances` | 0 filas (se borraron los artefactos del usuario QA) |
| `checkout_intents` | 5 filas históricas de `kherrera` |
| Auth | 3 usuarios; el payer de prueba `test_user_532412195559500595@testuser.com` fue eliminado |
| Preapprovals MP creados por el QA | todos `cancelled` (verificado por `/preapproval/search`) |

> Los pagos siguen **aprobados y sin devolución** en MP: no se movió dinero real.

---

## 5. Limitaciones declaradas

- **Reembolsos/contracargos sintéticos:** el fold, los emails, la UI y la idempotencia se
  prueban con payloads reales de MP, pero la transición `approved → refunded` no se dispara
  desde el panel de MP en esta corrida (los pagos semilla son live). Para un QA 100 %
  end-to-end hace falta un pago nuevo creado con credenciales TEST reales
  (`live_mode:false`); hoy `NEXT_PUBLIC_MP_PUBLIC_KEY` es live y la tokenización de tarjeta
  falla con `401 "Unauthorized use of live credentials"`.
- **Contracargo real:** MP no expone creación de disputas por API; el topic y el pull se
  validan con el `502` de un id inexistente y el fold con payloads sintéticos.
- **Sync real:** se ejecuta `syncUserCycle(force)` contra MP; como MP sigue `approved`, se
  verifica que el merge monótono **no revierte** el `refunded`/`partially_refunded` local.
- **Emails:** se enviaron correos reales a `kherrera@pioix.edu.ar` y alertas internas al
  `EMAIL_FROM` (fallback de `LEGAL_EMAIL`, que no está configurado).

---

## 6. Fix posterior — loop de sync en `/perfil` sin fila de ciclo (23-nov-2026)

Durante la verificación manual apareció un caso que el QA no cubría: `kherrera`
(`ced3fa8c-…`) tiene `users.plan='pro'` y **cero filas en `subscriptions`** (foto inicial
restaurada por el propio QA). Cada `GET /perfil` tardaba 3–8 s y, a veces, logueaba
`[mp preapproval search] "The operation was aborted due to timeout"`.

**Causa.** El lease/TTL de R12.3 vive en `subscriptions.last_synced_at`; sin fila no hay
dónde medirlo. El sync caía al watermark de `checkout_intents`, buscaba preapprovals en MP,
adoptaba el más nuevo (`d776879f…`, ya `cancelled`) y escribía `users.mp_preapproval_id`,
pero no podía persistir `subscriptions.preapproval_id` porque la fila no existe. El próximo
render repetía la búsqueda: loop sin estado durable.

**Fix.**

- `syncUserCycle` corta con `outcome='no_subscription'` antes de tocar MP cuando no hay fila,
  el plan ya no es `free`, el trigger es `perfil` y no es `force`.
- `reconcileUserCycle` hace el mismo corte antes de invocar al sync (evita el round-trip
  extra a `users`/`subscriptions` en el render).
- La recuperación de un seed perdido sigue disponible con el botón **“Verifico de nuevo”**
  (`force:true`) y con la vuelta del checkout.
- Sin fila, el sync usa `users.mp_preapproval_id` como hint para no re-buscar el preapproval
  en cada verificación manual; con fila sigue mandando `subscriptions.preapproval_id`.
- `/preapproval/search` on-read se corta a **3 s** (`SYNC_PREAPPROVAL_ON_READ_TIMEOUT_MS`);
  el manual conserva el presupuesto completo.
- `users` y `subscriptions` se leen en paralelo para no pagar dos round-trips antes de
  decidir.

**Evidencia.** `GET /perfil` autenticado ⇒ 200 con “Plan PRO”, **2,4 s** en dev y sin ningún
`[mp sync]` ni `[mp preapproval search]` en el log. `syncUserCycle({trigger:'manual',
force:true})` sigue devolviendo `ok` usando el hint. **366/366 tests unitarios** (4 nuevos en
`payments-sync.test.ts`), typecheck 0.

