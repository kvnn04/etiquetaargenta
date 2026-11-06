/* ============================================================================
 * not-found de /v/[linkId] — enlace INEXISTENTE (posición 10A, §6)
 * "No encontramos esta propuesta": amable y limpia, jamás un 404 técnico
 * pelado. CTA de contacto NO hay: un linkId inexistente no sabe de qué taller
 * es — el texto invita a pedir el enlace correcto.
 * ============================================================================ */

export default function PublicLinkNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0b0d] px-6 py-10 text-center">
      <div className="max-w-sm space-y-4">
        <span className="mx-auto flex size-12 items-center justify-center rounded-lg bg-gold/20 text-sm font-bold text-gold-soft">
          MO
        </span>
        <h1 className="text-sm font-bold text-stone-100">No encontramos esta propuesta</h1>
        <p className="text-xs leading-relaxed text-stone-400">
          El enlace puede estar mal escrito o la propuesta fue quitada. Pedile al taller el enlace
          correcto de tu mate personalizado.
        </p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-600">
          MOCAP 3D · Mate Personalizado
        </p>
      </div>
    </main>
  );
}
