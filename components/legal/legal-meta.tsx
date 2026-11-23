import { LEGAL_LAST_UPDATED_LABEL, LEGAL_VERSIONS, type LegalDocument } from '@/lib/legal/config';

/** Versión + fecha visible en cada página (R13.1/R13.16). */
export default function LegalMeta({ document }: { document: LegalDocument }) {
  const version = LEGAL_VERSIONS[document];
  const label = document === 'terms' ? 'Términos y Condiciones' : 'Política de Privacidad';
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
      <span className="rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-stone-300">
        {label} v{version}
      </span>
      <span aria-hidden>·</span>
      <span>Última actualización: {LEGAL_LAST_UPDATED_LABEL}</span>
    </p>
  );
}
