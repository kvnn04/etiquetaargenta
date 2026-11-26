'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  MessageCircle,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { canonicalSiteOrigin } from '@/lib/http/origin';
import {
  canonicalLinkUrl,
  editionBadgeText,
  linkDaysLeft,
  whatsappShareHref,
} from '@/lib/links/states';
import { formatLinkDate } from '@/lib/links/responses';
import {
  filterAndSortLinks,
  linkManagementState,
  type LinkManagementFilter,
  type LinkManagementRow,
  type LinkManagementSort,
} from '@/lib/links/management';

const FILTERS: ReadonlyArray<{ id: LinkManagementFilter; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'vigente', label: 'Vigentes' },
  { id: 'por_vencer', label: 'Por vencer' },
  { id: 'vencido', label: 'Vencidos' },
  { id: 'aprobado', label: 'Aprobados' },
  { id: 'rechazado', label: 'Rechazados' },
  { id: 'observacion', label: 'Con observación' },
];

function badgeClass(state: ReturnType<typeof linkManagementState>): string {
  switch (state) {
    case 'rechazado':
      return 'border-rose-500/40 text-rose-300';
    case 'aprobado':
      return 'border-gold/50 text-gold-soft';
    case 'vigente':
      return 'border-emerald-500/40 text-emerald-400';
    case 'por_vencer':
      return 'border-amber-500/40 text-amber-300';
    default:
      return 'border-line text-stone-600';
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-stone-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-cream">{value}</p>
    </div>
  );
}

export default function LinksManager({
  rows: initialRows,
  nowMs,
  loadError = false,
}: {
  rows: LinkManagementRow[];
  /** Instante del render server: evita saltos de hidratación en los badges. */
  nowMs: number;
  loadError?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LinkManagementFilter>('todos');
  const [sort, setSort] = useState<LinkManagementSort>('recientes');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const base: Record<LinkManagementFilter, number> = {
      todos: rows.length,
      vigente: 0,
      por_vencer: 0,
      vencido: 0,
      aprobado: 0,
      rechazado: 0,
      observacion: 0,
    };
    for (const row of rows) {
      base[linkManagementState(row, nowMs)] += 1;
      if (row.observation) base.observacion += 1;
    }
    return base;
  }, [rows, nowMs]);

  const visible = useMemo(
    () => filterAndSortLinks(rows, { query, filter, sort, nowMs }),
    [rows, query, filter, sort, nowMs],
  );

  async function copyLink(linkId: string): Promise<void> {
    try {
      const url = canonicalLinkUrl(linkId, canonicalSiteOrigin(window.location.origin));
      await navigator.clipboard.writeText(url);
      setCopiedId(linkId);
      window.setTimeout(() => {
        setCopiedId((current) => (current === linkId ? null : current));
      }, 1800);
    } catch {
      setError('El navegador bloqueó el portapapeles: copiá el enlace desde el navegador.');
    }
  }

  function shareWhatsApp(linkId: string): void {
    const url = canonicalLinkUrl(linkId, canonicalSiteOrigin(window.location.origin));
    window.open(whatsappShareHref(url), '_blank', 'noopener,noreferrer');
  }

  async function deleteLink(linkId: string): Promise<void> {
    if (deletingId) return;
    setDeletingId(linkId);
    setError(null);
    try {
      const response = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
      if (response.status === 401) {
        setError('Tu sesión venció: volvé a iniciar sesión.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo eliminar el enlace. Intentá de nuevo.');
        return;
      }
      setRows((current) => current.filter((row) => row.linkId !== linkId));
      setConfirmDeleteId(null);
    } catch {
      setError('No se pudo eliminar el enlace: revisá la conexión.');
    } finally {
      setDeletingId(null);
    }
  }

  function clearFilters(): void {
    setQuery('');
    setFilter('todos');
  }

  const activeCount = counts.vigente + counts.por_vencer;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-cream">
            <Link2 className="size-4 text-gold-soft" aria-hidden /> Mis enlaces
          </h1>
          <p className="mt-1 text-[11px] text-stone-500">
            Buscá, abrí y gestioná todas las versiones que publicaste, sin entrar proyecto por proyecto.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/perfil"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <UserRound className="size-3.5" /> Perfil
          </Link>
          <Link
            href="/editor"
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }))}
          >
            Ir al editor
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Enlaces" value={rows.length} />
        <Stat label="Vigentes" value={activeCount} />
        <Stat label="Con observación" value={counts.observacion} />
      </div>

      {loadError && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          No pudimos cargar todos tus enlaces.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-bold underline underline-offset-2"
          >
            Recargar
          </button>
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-line bg-panel p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por link, proyecto, modelo, observación…"
              aria-label="Buscar enlaces"
              className="h-10 w-full rounded-lg border border-white/10 bg-black/30 pl-9 pr-9 text-sm text-cream outline-none placeholder:text-stone-600 focus:border-gold/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-500 hover:text-stone-200"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as LinkManagementSort)}
            aria-label="Ordenar enlaces"
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-cream outline-none focus:border-gold/60"
          >
            <option value="recientes">Más recientes</option>
            <option value="vence_pronto">Vencen antes</option>
            <option value="proyecto">Por proyecto</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => {
            const active = filter === entry.id;
            const count = counts[entry.id];
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold transition',
                  active
                    ? 'border-gold/50 bg-gold/15 text-gold-soft'
                    : 'border-line text-stone-500 hover:border-white/20 hover:text-stone-300',
                )}
              >
                {entry.label}
                {count > 0 && (
                  <span className={cn('text-[9px]', active ? 'text-gold-soft/80' : 'text-stone-600')}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-stone-500">
          {visible.length} de {rows.length} enlaces
          {query.trim() ? ` para “${query.trim()}”` : ''}
        </p>
        {(query || filter !== 'todos') && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-[10px] font-bold text-gold-soft hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <section className="rounded-xl border border-dashed border-line bg-panel p-8 text-center">
          <Link2 className="mx-auto size-8 text-stone-600" aria-hidden />
          <h2 className="mt-2 text-sm font-bold text-stone-200">Todavía no publicaste enlaces</h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-stone-500">
            Cargá un diseño en el editor y usá «Generar Enlace Comercial». Acá vas a poder verlos,
            buscarlos y gestionarlos todos juntos.
          </p>
          <Link
            href="/editor"
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'mt-4')}
          >
            Ir al editor
          </Link>
        </section>
      ) : visible.length === 0 ? (
        <section className="rounded-xl border border-dashed border-line bg-panel p-8 text-center">
          <Search className="mx-auto size-8 text-stone-600" aria-hidden />
          <h2 className="mt-2 text-sm font-bold text-stone-200">No hay enlaces que coincidan</h2>
          <p className="mt-1 text-xs text-stone-500">
            Probá con otro texto o quitá los filtros para ver todos tus enlaces.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-4')}
          >
            Limpiar filtros
          </button>
        </section>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => {
            const state = linkManagementState(row, nowMs);
            const badgeVariant =
              row.decision === 'approved' ? row.decisionVariantId : row.lastApprovedVariant;
            const daysLeft = linkDaysLeft(Date.parse(row.expiresAt) || 0, nowMs);
            const linkPath = `/v/${row.linkId}`;
            const projectPath = `/editor?project=${row.projectId}`;
            const observationTitle =
              row.decision === 'rejected' ? 'Motivo del rechazo' : 'Observación del cliente';

            return (
              <li key={row.linkId} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase',
                          badgeClass(state),
                        )}
                      >
                        {editionBadgeText(state, badgeVariant)}
                      </span>
                      <span className="truncate text-[11px] font-semibold text-stone-300">
                        {row.projectTitle}
                      </span>
                      <span className="font-mono text-[9px] text-stone-600">
                        #{row.projectId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <a
                        href={linkPath}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm font-semibold text-gold-soft hover:underline"
                      >
                        /v/{row.linkId}
                      </a>
                      <span className="text-[10px] text-stone-500">v{row.version}</span>
                      {row.mateModel && (
                        <span className="text-[10px] text-stone-500">· {row.mateModel}</span>
                      )}
                      {row.variantLabel && (
                        <span className="text-[10px] text-stone-600">· {row.variantLabel}</span>
                      )}
                      {row.approvalsCount > 0 && (
                        <span className="text-[10px] text-emerald-400">
                          · {row.approvalsCount} aprobación{row.approvalsCount === 1 ? '' : 'es'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-stone-600">
                      Creado {formatLinkDate(row.createdAt)} · Vence {formatLinkDate(row.expiresAt)}
                      {state !== 'vencido' && ` (${daysLeft} d)`}
                    </p>
                    {row.decision && (
                      <p className="mt-0.5 text-[10px] text-stone-500">
                        Decisión: {row.decision === 'approved' ? 'aprobada' : 'rechazada'} ·{' '}
                        {formatLinkDate(row.decidedAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void copyLink(row.linkId)}
                      aria-label={`Copiar enlace ${row.linkId}`}
                      title="Copiar enlace"
                      className="rounded-md p-1.5 text-stone-500 hover:bg-white/5 hover:text-stone-200"
                    >
                      {copiedId === row.linkId ? (
                        <Check className="size-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    <a
                      href={linkPath}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir enlace ${row.linkId}`}
                      title="Abrir vista del cliente"
                      className="rounded-md p-1.5 text-stone-500 hover:bg-white/5 hover:text-stone-200"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => shareWhatsApp(row.linkId)}
                      aria-label={`Compartir enlace ${row.linkId} por WhatsApp`}
                      title="Compartir por WhatsApp"
                      className="rounded-md p-1.5 text-stone-500 hover:bg-white/5 hover:text-emerald-300"
                    >
                      <MessageCircle className="size-3.5" />
                    </button>
                    <a
                      href={projectPath}
                      aria-label={`Abrir proyecto de ${row.linkId}`}
                      title="Abrir proyecto en el editor"
                      className="rounded-md p-1.5 text-stone-500 hover:bg-white/5 hover:text-stone-200"
                    >
                      <FolderOpen className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDeleteId((current) =>
                          current === row.linkId ? null : row.linkId,
                        )
                      }
                      disabled={deletingId !== null}
                      aria-label={`Eliminar enlace ${row.linkId}`}
                      title="Eliminar enlace"
                      className={cn(
                        'rounded-md p-1.5 hover:bg-white/5',
                        confirmDeleteId === row.linkId
                          ? 'text-rose-300'
                          : 'text-stone-500 hover:text-rose-300',
                      )}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {row.observation && (
                  <details className="mt-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
                    <summary className="cursor-pointer text-[10px] font-bold text-sky-300">
                      {observationTitle}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-stone-300">
                      {row.observation}
                    </p>
                    <p className="mt-1 text-[9px] text-stone-500">
                      {formatLinkDate(row.observedAt)}
                    </p>
                  </details>
                )}

                {confirmDeleteId === row.linkId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
                    <span className="text-[10px] text-rose-200">
                      ¿Eliminar /v/{row.linkId} y sus respuestas?
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteLink(row.linkId)}
                      disabled={deletingId === row.linkId}
                      className="rounded-md border border-rose-400/40 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      {deletingId === row.linkId ? 'Eliminando…' : 'Sí, eliminar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deletingId === row.linkId}
                      className="px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-stone-200 disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
