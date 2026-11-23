import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_LINKS, legalMetadata } from '@/lib/legal/config';
import { LEGAL_RESPONSE_HOURS } from '@/lib/legal/requests';
import LegalIdentity from '@/components/legal/legal-identity';
import BajaForm from '@/components/legal/baja-form';

/* ============================================================================
 * /baja — BOTÓN DE BAJA DE SERVICIO (R13.2/R13.3/R13.6)
 * Público, sin login, sin justificar el motivo ni llamar por teléfono. Este
 * paso NO cancela: manda un link de confirmación de 24 h (doble opt-in) para
 * que un tercero no pueda dar de baja la cuenta ajena.
 * ============================================================================ */

export const dynamic = 'force-dynamic';

export const metadata = legalMetadata({
  title: 'Botón de Baja de Servicio',
  description:
    'Pedí la baja del Plan PRO sin login ni justificar el motivo. Se cancela el débito automático y el acceso sigue hasta el fin del ciclo ya pago.',
  path: LEGAL_LINKS.cancellation,
});

export default function BajaPage() {
  return (
    <article className="legal-prose">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">
          Derechos del consumidor
        </p>
        <h1 className="mt-1 text-2xl font-bold text-cream sm:text-3xl">Botón de Baja de Servicio</h1>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Podés dar de baja el Plan PRO en cualquier momento. No tenés que justificar el motivo, no
          hace falta login y no hay penalidad. La baja cancela el débito automático; el acceso sigue
          hasta el <strong className="text-stone-200">fin del ciclo ya pago</strong> y no se generan
          cobros posteriores.
        </p>
      </header>

      <section className="not-prose rounded-2xl border border-gold/30 bg-panel/70 p-4 sm:p-5">
        <h2 className="text-base font-bold text-cream">Pedir la baja</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-400">
          Completá el email con el que contrataste. Te enviamos un link de confirmación válido 24
          horas: la baja se ejecuta recién cuando lo abrís. Así evitamos que un tercero cancele tu
          cuenta sin tu permiso.
        </p>
        <div className="mt-4">
          <BajaForm contactEmail={LEGAL_ENTITY.email} />
        </div>
      </section>

      <LegalIdentity compact />

      <h2>Cómo funciona la baja</h2>
      <ol>
        <li>
          <strong>Pedís la baja.</strong> Te mostramos un código{' '}
          <span className="font-mono">BAJA-AAAAAMMDD-XXXX</span> y te mandamos un link de
          confirmación al email de la cuenta.
        </li>
        <li>
          <strong>Confirmás desde tu email.</strong> El link dura 24 horas y se usa una sola vez.
          Si no lo abrís, no se cancela nada. Si el link vence, podés pedir otro con el mismo código.
        </li>
        <li>
          <strong>Cancela el débito.</strong> Verificamos que el email sea el de la cuenta y que la
          suscripción te pertenezca; recién ahí cancelamos en Mercado Pago. Si algo no coincide, no
          cancelamos y te contactamos.
        </li>
        <li>
          <strong>Conservás tu trabajo.</strong> Tus proyectos, assets, fichas y enlaces quedan
          intactos. Podés volver a suscribirte cuando quieras.
        </li>
      </ol>
      <p>
        Respondemos dentro de {LEGAL_RESPONSE_HOURS} horas. Si la cuenta no tiene un débito
        automático asociado o Mercado Pago no responde, la solicitud queda en la cola de atención
        manual dentro del mismo plazo.
      </p>

      <h2>Vías adicionales</h2>
      <p>
        También podés cancelar desde el Portal de Mercado Pago, en la sección de suscripciones. El
        Portal es una vía adicional, nunca la única. Si tenés un problema con el formulario,
        escribinos al canal publicado en el bloque de identidad y guardá el código de la solicitud.
      </p>
      <p>
        La baja no elimina tus datos por sí sola. Si además querés suprimir la cuenta, usá el{' '}
        <Link href={LEGAL_LINKS.privacyRights}>formulario de derechos de datos</Link> o la opción
        &quot;Eliminar cuenta&quot; del perfil. El borrado de cuenta tiene 30 días de restauración.
      </p>

      <h2>Si te arrepentiste de una compra</h2>
      <p>
        La baja no equivale al arrepentimiento. Si contrataste hace menos de 10 días corridos y
        querés la devolución del ciclo, usá el{' '}
        <Link href={LEGAL_LINKS.withdrawal}>Botón de Arrepentimiento</Link>. También podés pedir la
        baja y después el reembolso; son derechos independientes (Ley 24.240 art. 34 y Disposición
        954/2025).
      </p>

      <p className="legal-note">
        Sin llamadas obligatorias, sin formularios ocultos y sin retención. La atención electrónica
        es de lunes a viernes de 9:00 a 18:00 (hora de Argentina), con un mínimo de 8 horas por día
        hábil.
      </p>
    </article>
  );
}
