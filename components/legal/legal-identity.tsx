import Link from 'next/link';
import {
  LEGAL_ATTENTION_AREA,
  LEGAL_ENTITY,
  LEGAL_LINKS,
  legalIdentityMissing,
} from '@/lib/legal/config';

/* ============================================================================
 * BLOQUE DE IDENTIDAD DEL PROVEEDOR — posición 12 (R13.1 + §3.2/§3.3)
 * ----------------------------------------------------------------------------
 * Server component. Los datos salen de LEGAL_ENTITY_* / LEGAL_* (Q1): si falta
 * alguno, NO se inventa: se declara visiblemente qué falta completar antes del
 * go-live. La página sigue siendo navegable y el canal de formularios funciona.
 * ============================================================================ */

export default function LegalIdentity({ compact = false }: { compact?: boolean }) {
  const missing = legalIdentityMissing();
  const hasPhone = Boolean(LEGAL_ENTITY.phone || LEGAL_ENTITY.whatsapp);

  return (
    <section
      aria-labelledby="identidad-proveedor"
      className={`not-prose rounded-xl border border-line bg-panel/70 ${
        compact ? 'p-3.5' : 'p-4 sm:p-5'
      }`}
    >
      <h2
        id="identidad-proveedor"
        className="text-[11px] font-bold uppercase tracking-[.2em] text-gold-soft"
      >
        Identidad del proveedor
      </h2>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-stone-500">Nombre comercial</dt>
          <dd className="text-stone-200">{LEGAL_ENTITY.name}</dd>
        </div>
        {LEGAL_ENTITY.legalName && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">Razón social</dt>
            <dd className="text-stone-200">{LEGAL_ENTITY.legalName}</dd>
          </div>
        )}
        {LEGAL_ENTITY.cuit && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">CUIT</dt>
            <dd className="font-mono text-stone-200">{LEGAL_ENTITY.cuit}</dd>
          </div>
        )}
        {LEGAL_ENTITY.taxCondition && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">
              Condición fiscal
            </dt>
            <dd className="text-stone-200">{LEGAL_ENTITY.taxCondition}</dd>
          </div>
        )}
        {LEGAL_ENTITY.address && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wider text-stone-500">Domicilio legal</dt>
            <dd className="text-stone-200">{LEGAL_ENTITY.address}</dd>
          </div>
        )}
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-stone-500">Atención</dt>
          <dd className="text-stone-200">
            {LEGAL_ATTENTION_AREA}
            <br />
            {LEGAL_ENTITY.hours}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-stone-500">Canal</dt>
          <dd className="space-y-1 text-stone-200">
            {LEGAL_ENTITY.email ? (
              <a className="underline decoration-gold/40 underline-offset-2 hover:text-gold-soft" href={`mailto:${LEGAL_ENTITY.email}`}>
                {LEGAL_ENTITY.email}
              </a>
            ) : (
              <span>
                Formularios de{' '}
                <Link className="underline decoration-gold/40 underline-offset-2 hover:text-gold-soft" href={LEGAL_LINKS.withdrawal}>
                  arrepentimiento
                </Link>{' '}
                y{' '}
                <Link className="underline decoration-gold/40 underline-offset-2 hover:text-gold-soft" href={LEGAL_LINKS.privacyRights}>
                  derechos de datos
                </Link>
                .
              </span>
            )}
            {LEGAL_ENTITY.phone && (
              <span className="block">
                Teléfono: <span className="font-mono">{LEGAL_ENTITY.phone}</span>
              </span>
            )}
            {LEGAL_ENTITY.whatsapp && (
              <span className="block">
                WhatsApp: <span className="font-mono">{LEGAL_ENTITY.whatsapp}</span>
              </span>
            )}
            {!hasPhone && (
              <span className="block text-[10px] text-stone-500">
                Atención electrónica por email y formularios.
              </span>
            )}
          </dd>
        </div>
      </dl>

      {missing.length > 0 && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          <strong>Publicación pendiente de datos del titular:</strong> {missing.join(', ')}. Se
          completan con las variables <span className="font-mono">LEGAL_ENTITY_*</span> /{' '}
          <span className="font-mono">LEGAL_EMAIL</span> antes del go-live; no inventamos datos
          legales.
        </p>
      )}
    </section>
  );
}
