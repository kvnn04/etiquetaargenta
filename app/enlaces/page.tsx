import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { formatModeloCard } from '@/lib/quote/snapshot';
import LinksManager from '@/components/links/links-manager';
import type { LinkManagementRow } from '@/lib/links/management';
import {
  toPublicLinkResponse,
  type LinkResponseRow,
} from '@/lib/links/responses';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mis enlaces · MOCAP',
  description: 'Todos los enlaces comerciales del taller en un solo lugar.',
};

/** Tope defensivo: el taller promedio no llega ni cerca de 500 versiones. */
const LINKS_LIMIT = 500;

interface LinkRow {
  link_id: string;
  project_id: string;
  version: number;
  created_at: string;
  expires_at: string;
  payload: unknown;
}

interface ProjectRow {
  id: string;
  title: string;
}

interface ApprovalRow {
  link_id: string;
  variant_id: string;
  approved_at: string;
}

/**
 * Gestión global de enlaces (sin entrar proyecto por proyecto).
 * El listado se resuelve SERVER-SIDE con service-role y filtro explícito por
 * `user_id`: `link_responses` no tiene policies para `authenticated`, y el
 * service client JAMÁS se usa sin el filtro del dueño.
 */
export default async function LinksPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const service = createSupabaseServiceClient();
  let loadError = false;

  const linksResult = await service
    .from('links')
    .select('link_id, project_id, version, created_at, expires_at, payload')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(LINKS_LIMIT);

  if (linksResult.error) {
    console.error('[enlaces links]:', linksResult.error.message);
    loadError = true;
  }

  const links = (linksResult.data ?? []) as LinkRow[];
  const linkIds = links.map((link) => link.link_id);
  const projectIds = Array.from(new Set(links.map((link) => link.project_id)));

  const [projectsResult, approvalsResult, responsesResult] = await Promise.all([
    projectIds.length
      ? service.from('projects').select('id, title').eq('user_id', user.id).in('id', projectIds)
      : Promise.resolve({ data: [] as ProjectRow[], error: null }),
    linkIds.length
      ? service
          .from('link_approvals')
          .select('link_id, variant_id, approved_at')
          .in('link_id', linkIds)
          .order('approved_at', { ascending: false })
          .limit(5000)
      : Promise.resolve({ data: [] as ApprovalRow[], error: null }),
    linkIds.length
      ? service
          .from('link_responses')
          .select(
            'link_id, decision, decision_variant_id, decided_at, decision_channel, decision_email_sent_at, decision_email_error, observation, observed_at, observation_channel, observation_email_sent_at, observation_email_error',
          )
          .in('link_id', linkIds)
      : Promise.resolve({ data: [] as LinkResponseRow[], error: null }),
  ]);

  if (projectsResult.error) {
    console.error('[enlaces projects]:', projectsResult.error.message);
    loadError = true;
  }
  if (approvalsResult.error) {
    // Fail-soft: el badge legacy cae a "sin aprobaciones", igual que el modal.
    console.error('[enlaces approvals]:', approvalsResult.error.message);
  }
  if (responsesResult.error) {
    console.error('[enlaces responses]:', responsesResult.error.message);
    loadError = true;
  }

  const projectTitle = new Map<string, string>(
    ((projectsResult.data ?? []) as ProjectRow[]).map((project) => [project.id, project.title]),
  );

  const approvalByLink = new Map<string, { count: number; lastVariant: string | null }>();
  for (const approval of (approvalsResult.data ?? []) as ApprovalRow[]) {
    const acc = approvalByLink.get(approval.link_id) ?? { count: 0, lastVariant: null };
    acc.count += 1;
    if (!acc.lastVariant) acc.lastVariant = approval.variant_id;
    approvalByLink.set(approval.link_id, acc);
  }

  const responseByLink = new Map<string, LinkResponseRow>();
  for (const response of (responsesResult.data ?? []) as LinkResponseRow[]) {
    if (response.link_id) responseByLink.set(response.link_id, response);
  }

  const rows: LinkManagementRow[] = links.map((link) => {
    const payload =
      link.payload !== null && typeof link.payload === 'object'
        ? (link.payload as {
            mateConfig?: { model?: unknown };
            variants?: unknown;
          })
        : {};

    const modelId =
      typeof payload.mateConfig?.model === 'string' ? payload.mateConfig.model : null;
    const mateModel = modelId ? formatModeloCard(modelId).etiqueta : null;

    const firstVariant = Array.isArray(payload.variants)
      ? (payload.variants[0] as { label?: unknown } | undefined)
      : undefined;
    const variantLabel =
      typeof firstVariant?.label === 'string' && firstVariant.label.trim().length > 0
        ? firstVariant.label.trim()
        : null;

    const response = toPublicLinkResponse(responseByLink.get(link.link_id));
    const approvals = approvalByLink.get(link.link_id);

    return {
      linkId: link.link_id,
      projectId: link.project_id,
      projectTitle: projectTitle.get(link.project_id) ?? 'Proyecto',
      version: link.version,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      approvalsCount: approvals?.count ?? 0,
      lastApprovedVariant: approvals?.lastVariant ?? null,
      decision: response?.decision ?? null,
      decisionVariantId: response?.decisionVariantId ?? null,
      decidedAt: response?.decidedAt ?? null,
      observation: response?.observation ?? null,
      observedAt: response?.observedAt ?? null,
      mateModel,
      variantLabel,
    };
  });

  return <LinksManager rows={rows} nowMs={Date.now()} loadError={loadError} />;
}
