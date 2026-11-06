/* ============================================================================
 * /v/[linkId] — MODO CLIENTE (página SERVER, posición 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md §3-R5/§6
 * ----------------------------------------------------------------------------
 * Server component con SERVICE-ROLE:
 *   · lectura de UNA fila `links` por link_id (público de verdad: sin sesión,
 *     R8 — abrir/ver/aprobar NO paga ni loguea);
 *   · `linkId` inexistente ⇒ notFound() con not-found.tsx AMABLE de este
 *     segmento ("No encontramos esta propuesta", jamás un 404 pelado);
 *   · `expiresAt` pasado (o no parseable) ⇒ página amable de vigencia con la
 *     marca del taller y su CTA de contacto — el CONTENIDO JAMÁS se muestra
 *     vencido (R5: la escena no existe para el visitante);
 *   · vigente ⇒ jsonb crudo ⇒ buildPublicView (normalizador tolerante) ⇒
 *     ClientViewer (client-only; R3F no puede SSR).
 * noindex en metadata: las propuestas son enlaces privados por cliente.
 * ============================================================================ */

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { canonicalizeLinkId } from '@/lib/links/identity';
import { buildPublicView, type PublicLinkView } from '@/lib/links/view-shape';
import ClientViewer from '@/components/links/client-viewer';

export const dynamic = 'force-dynamic'; // vigencia en vivo: cache prohibida
export const runtime = 'nodejs';

export const metadata = {
  title: 'Propuesta 3D · MOCAP 3D',
  robots: { index: false, follow: false },
};

interface LinkRow {
  payload: unknown;
  expires_at: string;
}

/* -------------------------------------------------------------------------- */
/* Páginas amables (§4/§6): limpias, con marca, sin pantallas de error técnica */
/* -------------------------------------------------------------------------- */

function WorkshopMark({ view, large }: { view: PublicLinkView | null; large?: boolean }) {
  const name = view?.workshop.name ?? 'MOCAP 3D · MATE PERSONALIZADO';
  return (
    <div className="flex items-center gap-2.5">
      {view?.workshop.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={view.workshop.logoUrl}
          alt=""
          className={`${large ? 'size-12' : 'size-9'} rounded-lg object-cover`}
        />
      ) : (
        <span
          className={`${large ? 'size-12 text-sm' : 'size-9 text-[11px]'} flex items-center justify-center rounded-lg bg-gold/20 font-bold text-gold-soft`}
        >
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? '')
            .join('') || 'MO'}
        </span>
      )}
      <p className="text-xs font-bold text-stone-200">{name}</p>
    </div>
  );
}

function FriendlyShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0b0d] px-6 py-10">
      <div className="max-w-sm space-y-4 text-center">{children}</div>
    </main>
  );
}

/** R5: vencido — marca del taller + CTA de contacto (si hay número vía wa.me). */
function ExpiredNotice({ view }: { view: PublicLinkView }) {
  const digits = view.workshop.whatsapp && view.workshop.whatsapp.length >= 6 ? view.workshop.whatsapp : null;
  const label = view.workshop.name || 'MOCAP 3D · MATE PERSONALIZADO';
  return (
    <FriendlyShell>
      <div className="flex flex-col items-center gap-3">
        <WorkshopMark view={view} large />
      </div>
      <h1 className="text-sm font-bold text-stone-100">Esta propuesta finalizó su vigencia</h1>
      <p className="text-xs leading-relaxed text-stone-400">
        Las propuestas 3D vencen a los 30 días por diseño del taller. Si querés volver a ver tus
        opciones, pedí a {label} un enlace actualizado.
      </p>
      {digits ? (
        <a
          href={`https://wa.me/${digits}?text=${encodeURIComponent(
            `¡Hola! Consulto por la propuesta 3D de mi mate personalizado (${label}).`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[11px] font-bold text-emerald-300"
        >
          Contactar al taller por WhatsApp
        </a>
      ) : (
        <p className="text-[10px] leading-relaxed text-stone-600">
          Ponete en contacto con el taller para recibir una propuesta nueva.
        </p>
      )}
    </FriendlyShell>
  );
}

/** Error transitorio de BD (503-honesto, con el mismo tono amable). */
function UnavailableNotice({ view }: { view: PublicLinkView | null }) {
  return (
    <FriendlyShell>
      <WorkshopMark view={view} />
      <h1 className="text-sm font-bold text-stone-100">La propuesta no se puede leer ahora</h1>
      <p className="text-xs leading-relaxed text-stone-400">
        Es un problema nuestro, no tuyo. Probá de nuevo en un momento o pedile al taller el enlace
        otra vez.
      </p>
    </FriendlyShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default async function PublicLinkPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId: raw } = await params;
  const linkId = canonicalizeLinkId(raw); // R2: canónico/case-insensitive; raro ⇒ null
  if (!linkId) notFound();

  const service = createSupabaseServiceClient();
  const row = await service
    .from('links')
    .select('payload, expires_at')
    .eq('link_id', linkId)
    .maybeSingle<LinkRow>();

  if (row.error) {
    console.error('[link view read]:', row.error.message);
    return <UnavailableNotice view={null} />;
  }
  if (!row.data) {
    // §6: "No encontramos esta propuesta" (amable, del propio segmento).
    notFound();
  }

  const view = buildPublicView(row.data.payload);
  if (!view.linkId) view.linkId = linkId; // jsonb dañado sin id: el PATH es la verdad

  const expiresMs = Date.parse(row.data.expires_at);
  if (Number.isNaN(expiresMs) || Date.now() >= expiresMs) {
    return <ExpiredNotice view={view} />; // R5: el contenido JAMÁS se muestra vencido
  }

  return <ClientViewer view={view} />;
}
