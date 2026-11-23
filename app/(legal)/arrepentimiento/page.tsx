import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_LINKS, legalMetadata, legalPriceLegend } from '@/lib/legal/config';
import { LEGAL_WITHDRAWAL_DAYS, LEGAL_RESPONSE_HOURS } from '@/lib/legal/requests';
import { readLegalPrice } from '@/lib/legal/service';
import LegalIdentity from '@/components/legal/legal-identity';
import WithdrawalForm from '@/components/legal/withdrawal-form';

/* ============================================================================
 * /arrepentimiento — BOTÓN DE ARREPENTIMIENTO (R13.2/R13.3/R13.5)
 * Público, sin login, sin justificar el motivo. Formulario + explicación del
 * derecho de 10 días corridos (Ley 24.240 art. 34 + Disposición 954/2025) y
 * del reembolso del ciclo completo por el mismo medio de pago.
 * ============================================================================ */

export const dynamic = 'force-dynamic';

export const metadata = legalMetadata({
  title: 'Botón de Arrepentimiento',
  description:
    'Ejercé tu derecho de arrepentimiento dentro de los 10 días corridos. Sin login ni justificar el motivo. Solicitud con código y respuesta en 24 horas.',
  path: LEGAL_LINKS.withdrawal,
});

export default async function WithdrawalPage() {
  const price = await readLegalPrice();
  const priceLegend = legalPriceLegend(price?.label ?? null);

  return (
    <article className="legal-prose">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">
          Derechos del consumidor
        </p>
        <h1 className="mt-1 text-2xl font-bold text-cream sm:text-3xl">
          Botón de Arrepentimiento
        </h1>
        <p className="mt-3 text-xs leading-relaxed text-stone-400">
          Si contrataste el Plan PRO y te arrepentiste, podés pedir la devolución dentro de los{' '}
          <strong className="text-stone-200">{LEGAL_WITHDRAWAL_DAYS} días corridos</strong> desde la
          celebración del contrato o la entrega. Es un derecho legal: no tenés que justificar el
          motivo, no hace falta login y no perdés tus proyectos.
        </p>
      </header>

      <section className="not-prose rounded-2xl border border-gold/30 bg-panel/70 p-4 sm:p-5">
        <h2 className="text-base font-bold text-cream">Solicitar el arrepentimiento</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-400">
          Completá tus datos. Recibís un código en pantalla y un acuse por email. La solicitud se
          registra aunque la fecha informada quede fuera de los 10 días: la revisamos igual y
          respondemos con una decisión fundada.
        </p>
        <div className="mt-4">
          <WithdrawalForm contactEmail={LEGAL_ENTITY.email} />
        </div>
      </section>

      <LegalIdentity compact />

      <h2>Cómo funciona</h2>
      <ol>
        <li>
          <strong>Enviás el formulario.</strong> No pedimos motivo ni contraseña. Te mostramos un
          código <span className="font-mono">ARR-AAAAAMMDD-XXXX</span> y te lo mandamos por email.
        </li>
        <li>
          <strong>Respondemos en {LEGAL_RESPONSE_HOURS} horas.</strong> Confirmamos el encuadre del
          arrepentimiento y el reembolso del ciclo completo por el mismo medio de pago.
        </li>
        <li>
          <strong>Reintegro.</strong> Devolvemos el total del ciclo, incluso si usaste el
          simulador. La acreditación final depende de Mercado Pago y del banco emisor; no
          prometemos plazos bancarios que no controlamos. La comisión de Mercado Pago la absorbe la
          plataforma: no se descuenta del reintegro.
        </li>
        <li>
          <strong>Acceso.</strong> Si el reembolso avanza, damos de baja el plan. Tus proyectos,
          assets y enlaces se conservan; después del ciclo vuelven los límites del plan FREE.
        </li>
      </ol>

      <h2>Alcance y precio</h2>
      <p>
        El derecho alcanza a la contratación inicial y a las renovaciones automáticas. El plan PRO
        se ofrece por {priceLegend}. Si el arrepentimiento se ejerce después de un cobro de
        renovación, se devuelve ese ciclo completo. El plazo se cuenta en días corridos y el día de
        la compra es el día 0; el día {LEGAL_WITHDRAWAL_DAYS} todavía está dentro.
      </p>
      <p>
        Este botón no reemplaza ni limita los demás derechos de la Ley 24.240. Podés reclamar ante
        la{' '}
        <a href={LEGAL_LINKS.consumerDefense} target="_blank" rel="noopener noreferrer">
          Defensa del Consumidor
        </a>{' '}
        y consultar las condiciones completas en los{' '}
        <Link href={LEGAL_LINKS.terms}>Términos y Condiciones</Link>.
      </p>

      <h2>¿Preferís dar de baja sin pedir devolución?</h2>
      <p>
        Usá el <Link href={LEGAL_LINKS.cancellation}>Botón de Baja de Servicio</Link>. La baja
        cancela el débito automático y tu acceso sigue hasta el fin del ciclo ya pago. También podés
        cancelar desde el Portal de Mercado Pago, que es una vía adicional, nunca la única.
      </p>

      <h2>Si no podés usar el formulario</h2>
      <p>
        Escribinos al canal publicado en el bloque de identidad dentro del mismo plazo. Si el
        problema es técnico, guardá el código que te mostró la pantalla o el acuse por email y
        respondé a ese mensaje: la solicitud ya quedó registrada.
      </p>

      <p className="legal-note">
        Atención electrónica de lunes a viernes de 9:00 a 18:00 (hora de Argentina), con un mínimo
        de 8 horas por día hábil. Fuente legal: Ley 24.240 art. 34 y Disposición 954/2025.
      </p>
    </article>
  );
}
