import Link from 'next/link';
import { LEGAL_LINKS, legalMetadata } from '@/lib/legal/config';
import { peekBajaByToken } from '@/lib/legal/service';
import BajaConfirm from '@/components/legal/baja-confirm';

/* ============================================================================
 * /baja/confirmar — CONFIRMACIÓN DE BAJA CON TOKEN (R13.6)
 * Noindex: el link contiene un token de un solo uso. La página NO confirma al
 * cargarse; muestra el detalle y exige un click explícito para que un escáner
 * de email no cancele la cuenta.
 * ============================================================================ */

export const dynamic = 'force-dynamic';

export const metadata = legalMetadata({
  title: 'Confirmar baja',
  description: 'Confirmación de la solicitud de baja del Plan PRO.',
  path: LEGAL_LINKS.cancellationConfirm,
  noindex: true,
});

export default async function BajaConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token?.trim() ?? '';
  const peek = token ? await peekBajaByToken(token) : { ok: false as const, reason: 'invalid' as const };

  if (!peek.ok) {
    return (
      <article className="legal-prose">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">
            Confirmación de baja
          </p>
          <h1 className="mt-1 text-2xl font-bold text-cream sm:text-3xl">
            El link no es válido
          </h1>
        </header>

        <div className="not-prose rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5 text-xs leading-relaxed text-amber-100/90">
          <p>
            El link de confirmación no existe, ya se usó o venció. <strong>No se canceló nada.</strong>{' '}
            Podés pedir uno nuevo desde el Botón de Baja con el mismo email: el código se conserva.
          </p>
        </div>

        <p>
          <Link href={LEGAL_LINKS.cancellation}>Pedir un link nuevo</Link> ·{' '}
          <Link href={LEGAL_LINKS.terms}>Términos y Condiciones</Link> ·{' '}
          <Link href={LEGAL_LINKS.privacy}>Política de Privacidad</Link>
        </p>
      </article>
    );
  }

  return (
    <article className="legal-prose">
      <div className="not-prose">
        <BajaConfirm
          token={token}
          code={peek.code}
          emailMasked={peek.emailMasked}
          expiresAtMs={peek.expiresAtMs}
          expired={peek.expired}
          confirmed={peek.confirmed}
        />
      </div>

      <h2 className="mt-8">Qué pasa al confirmar</h2>
      <ul>
        <li>Cancela el débito automático de Mercado Pago y no se generan cobros posteriores.</li>
        <li>El acceso PRO sigue hasta el fin del ciclo ya pago; después vuelven los límites FREE.</li>
        <li>Los proyectos, assets, fichas y enlaces se conservan.</li>
        <li>
          Si el email informado no coincide con la cuenta suscripta, no cancelamos nada y te
          contactamos para verificarlo.
        </li>
      </ul>

      <p className="legal-note">
        Este link es de un solo uso y vence a las 24 horas. Nunca te pedimos tarjeta ni contraseña
        por email.
      </p>
    </article>
  );
}
