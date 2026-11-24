# QA de integración — Posición 14 (decisión y observaciones del cliente)

**Fecha:** 23-nov-2026 · **Entorno:** Supabase TEST + Next dev local (sin Mercado Pago)
**Resultado:** ✅ **12/12 escenarios QA**, **394/394 tests unitarios**, `tsc --noEmit` sin
errores y build de producción con 32 rutas.

Este documento registra la corrida real del QA de la posición 14 contra la base TEST. No
se usaron mocks de base de datos: la tabla, las constraints, las RPCs, el RLS y los
endpoints públicos se ejercitan contra Supabase. La migración `0010_link_responses.sql`
quedó **aplicada a mano** en el SQL Editor el 23-nov-2026.

---

## 1. Cómo se corre

```powershell
# Requiere el .env del proyecto, el puerto 3100 libre y la 0010 aplicada.
$env:QA_ALLOW_MUTATIONS='1'
npm run test:qa -- tests/qa/link-responses.qa.test.ts
```

- `tests/qa/setup.ts` carga `.env` y exige `QA_ALLOW_MUTATIONS=1`: el QA **muta** la base
  TEST (crea un proyecto y links efímeros y los borra al final).
- El test levanta `next dev` en `http://127.0.0.1:3100` y lo baja en `afterAll`.
- `BASE_URL` es local a propósito: `QA_ORIGIN`/`MP_PUBLIC_ORIGIN` apunta al túnel ngrok de
  los QA de pagos y no sirve para este server.
- El proyecto QA se crea con la **sesión del taller** (`authenticated`), igual que la app:
  `projects` solo tiene grants para ese rol en este proyecto.
- `npm test` excluye `tests/qa/**` (los unitarios no tocan Supabase).

### Seguridad aplicada

- **No se envían emails reales.** El server HTTP del QA arranca con `RESEND_API_KEY=''` y
  `EMAIL_FROM=''` para ejercitar el fail-soft; las llamadas directas usan `captureResend()`,
  que intercepta `https://api.resend.com/emails` en el proceso y devuelve un `id` sintético.
- Los links de WhatsApp se generan y se inspeccionan como string; **no se abre** WhatsApp.
- Todo el estado vive en Supabase TEST y se limpia por cascada al borrar el proyecto QA.

---

## 2. Resultado por escenario

| # | Escenario | Resultado | Evidencia principal |
| :-- | :--- | :--- | :--- |
| 1 | **R14.1/R14.7** aprobación única, doble escritura legacy e inmutabilidad | ✅ | `POST decision` approved A ⇒ `200` + fila en `link_responses` + **1** fila en `link_approvals`; reintento ⇒ `200 already` sin duplicar; variante B o rechazo posterior ⇒ `409 DECISION_TAKEN`; `whatsappHref` con el número del taller; el visor **no muestra el footer legal** (decisión del titular, 23-nov-2026) |
| 2 | **R14.3/R14.14** rechazo con motivo obligatorio y 280 code points | ✅ | Sin motivo ⇒ `400 {reason:'observation_required'}`; solo espacios ⇒ `observation`; 281 ⇒ `observation`; **280 emojis 🪵** aceptados (`char_length=280`); decisión y motivo en la misma fila; reintento igual ⇒ `200 already`; motivo distinto ⇒ `409 OBSERVATION_TAKEN`; aprobar después ⇒ `409 DECISION_TAKEN`; `/v/[linkId]` muestra `RECHAZADO` + el texto y oculta el CTA de aprobar |
| 3 | **R14.4** observación sola, una vez y antes/después de aprobar | ✅ | Observación sin decisión ⇒ `200`; normalización `\r\n`/trim; reintento ⇒ `already`; aprobar después no la consume y queda en solo lectura |
| 4 | **R14.3/R14.4** rechazo que reutiliza la observación + email real | ✅ | Observación enviada por WhatsApp y rechazo por email ⇒ **1** email al taller con “Aviso de rechazo por: Email” y “Observación enviada por: WhatsApp”; `decision_email_sent_at` seteado, `observation_email_sent_at` nulo (no se duplica el aviso); reintento ⇒ `already` y **0** emails nuevos |
| 5 | **R14.5/R14.6** email de observación posterior a la aprobación | ✅ | Observación por email después de aprobar ⇒ asunto `Nueva observación de tu cliente — /v/{linkId}`, contexto “aprobada” y el texto; reintento ⇒ `already` sin reenviar |
| 6 | **R14.5** WhatsApp ausente | ✅ | Link sin número ⇒ rechazo por WhatsApp `400 WHATSAPP_UNAVAILABLE` y **cero filas** en `link_responses` |
| 7 | **R14.6** email sin credenciales ⇒ fila persistida + fallback | ✅ | Server sin Resend ⇒ `200` con `emailSent:false`, `emailError:'env-no-configurado'`; la fila queda con decisión, motivo y `*_email_error`; `whatsappHref` de rechazo presente; el panel muestra el estado |
| 8 | **R14.13** compatibilidad legacy con `link_approvals` | ✅ | Aprobación legacy sin fila en `link_responses` ⇒ decisión nueva `409 DECISION_TAKEN` con `legacy:true`; la observación sigue disponible **una vez**; el panel conserva el badge aprobado y luego la observación |
| 9 | **R14.9** vigencia y existencia | ✅ | Link vencido ⇒ `410 LINK_EXPIRED`; link borrado ⇒ `404`; en ambos casos **cero escrituras** |
| 10 | **R14.10** panel: decisión, observación, fecha y canales | ✅ | `GET /api/links` devuelve `decision`, `decisionVariantId`, `decidedAt`, `observation`, `observedAt`, `decisionChannel`, `observationChannel` y el estado del email del rechazo |
| 11 | **R14.11/R14.14** seguridad | ✅ | `anon` no lee ni inserta en `link_responses` (`42501`) y no puede ejecutar `link_register_decision` (`42501`); `service_role` sí lee y ejecuta |
| 12 | **R14.11/R14.14** escape y PII | ✅ | Observación `<script>alert(1)</script>` ⇒ el HTML del email contiene `&lt;script&gt;` y no `<script>`; no aparecen `cliente@` ni `+54` (sin datos de contacto del cliente) |

**Corrida final:** `Test Files 1 passed (1) · Tests 12 passed (12)` en **196,5 s**.

---

## 3. Bugs reales encontrados y corregidos durante el QA

1. **El test apuntaba al túnel ngrok.** `BASE_URL = QA_ORIGIN` resolvía a
   `MP_PUBLIC_ORIGIN` (`https://rented-unwed-jingle.ngrok-free.dev/`), pensado para los
   `back_url` de Mercado Pago. Los 8 escenarios HTTP daban `404` porque el server real
   corría en `127.0.0.1:3100`. Se fijó `BASE_URL = 'http://127.0.0.1:3100'`, igual que el
   QA de la posición 13.
2. **Faltaba el grant de INSERT en `link_approvals`.** La `0004` declaró la policy
   `approvals_public_insert` pero confió en los grants automáticos de Supabase, que este
   proyecto **no** aplica: `anon`, `authenticated` y `service_role` recibían `42501`. Se
   agregó a la `0010` el grant explícito para los tres roles; la policy sigue validando
   link existente y vigente.
3. **La RPC no comparaba la observación en un reintento.** Un segundo rechazo con un
   motivo **distinto** devolvía `200 already` en vez de `409 OBSERVATION_TAKEN`
   (R14.4/R14.7). `link_register_decision` ahora compara el texto normalizado antes de
   declarar idempotencia; el mismo texto sigue siendo `200 already`.
4. **`service_role` no puede insertar en `projects` en este proyecto.** El QA creaba el
   proyecto con el cliente de servicio y fallaba con `42501`. Ahora lo crea con la sesión
   del taller (`authenticated` + RLS `own_projects`), que es el flujo real de la app, y lo
   borra con el mismo cliente.

> Los puntos 2 y 3 son fixes de **esquema/RPC** en `0010_link_responses.sql`; el archivo se
> re-ejecutó completo en el SQL Editor (es idempotente) antes de la corrida verde.

---

## 4. Estado final de la base TEST (verificado)

| Elemento | Estado |
| :--- | :--- |
| `projects` con título del QA | 0 filas |
| `link_responses` | 0 filas (las del QA cayeron por cascada) |
| `link_approvals` | 0 filas |
| Tabla `link_responses` | existe; `service_role` lee, `anon` recibe `42501` |
| `link_register_decision` | existe; `service_role` ejecuta (`LINK_NOT_FOUND` con id falso), `anon` recibe `42501` |
| `link_register_observation` | ídem |

---

## 5. Limitaciones declaradas

- **Emails capturados, no entregados.** La corrida valida contenido, destinatario,
  `Idempotency-Key`, escape y ausencia de PII interceptando Resend; no prueba la entrega
  real de Resend (eso ya está cubierto por el QA de la posición 13 con un envío real).
- **WhatsApp no se abre.** Se valida el `href` (`wa.me/{número}?text=...`) y el texto
  pre-armado, no la entrega en la app del taller.
- **Sin navegador real.** La UI se valida por HTML server-rendered (`/v/[linkId]`) y por los
  contratos de los endpoints; los estados de foco/disabled están cubiertos por los tests
  unitarios y el typecheck.
- **Producción:** falta aplicar `0010_link_responses.sql` (con los grants y la RPC
  corregidos) en el proyecto productivo antes del deploy.

---

## 6. Ajuste posterior del titular (23-nov-2026)

Por decisión del titular, el **footer legal se retiró de `/v/[linkId]`**: el cliente
final del taller no contrata el SaaS, así que no debe ver Términos, Privacidad,
Defensa del Consumidor ni los botones de arrepentimiento/baja. El footer sigue en
`/auth`, `/editor` y `/perfil` (superficies del taller). El escenario 1 de este QA
verifica que el HTML del visor no contiene ninguno de esos textos; la spec
`spec_paginas_legales.md` (R13.2) quedó actualizada con el mismo criterio.
