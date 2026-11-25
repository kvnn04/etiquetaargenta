import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient, signedBrandingUrl } from '@/lib/supabase/service';
import EditorShell, { type ShellProfile } from '@/components/editor/editor-shell';
import type { Plan } from '@/lib/permissions';
import type { UserRecord } from '@/lib/types/db';
import { reconcileUserCycle } from '@/lib/payments/reconcile';
import { LEGAL_VERSIONS } from '@/lib/legal/config';
import { isAuthBypassEnabled } from '@/lib/dev-auth';
import {
  isProjectId,
  normalizeState,
  type InitialProject,
} from '@/lib/projects/persistence';
import { loadProjectDesignSource } from '@/lib/projects/design-source';
import type { DesignSourceRef } from '@/lib/design';

export const dynamic = 'force-dynamic';

/**
 * Editor (posiciones 3–7 traen la escena 3D acá).
 * El plan se resuelve SIEMPRE server-side (users.plan; el claim del JWT es
 * cache no autoritativa — spec_auth §3 Comportamiento del Sistema).
 * R8: si la fila está con deleted_at ⇒ signOut + mensaje neutro en /auth.
 */
export default async function EditorPage({
  searchParams,
}: {
  /**
   * Posición 13: “Reactivar PRO” del Centro abre el paywall normal.
   * `project`: proyecto a abrir desde «Mis enlaces» (se valida ownership).
   * `proyecto=no-disponible`: aviso tras un id inválido/ajeno/inexistente.
   */
  searchParams: Promise<{
    paywall?: string | string[];
    project?: string | string[];
    proyecto?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const initialPaywallOpen = params.paywall === '1';
  const projectParam = typeof params.project === 'string' ? params.project.trim() : '';
  const projectUnavailable = params.proyecto === 'no-disponible';

  /* DEV ONLY (DEV_AUTH_BYPASS=1): editor sin login. Perfil de prueba PRO para
   * trabajar las formas del mate sin marca de agua ni gates. */
  if (isAuthBypassEnabled()) {
    return (
      <EditorShell
        userId="dev-local"
        devBypass
        initialPaywallOpen={initialPaywallOpen}
        legalVersions={LEGAL_VERSIONS}
        projectUnavailable={false}
        initialProject={null}
        profile={{
          exists: true,
          baseName: 'Taller Dev',
          brandName: 'Taller Dev',
          plan: 'pro',
          graceExpiresAt: null,
          logoThumbUrl: null,
          whatsappE164: null,
          instagramHandle: null,
        }}
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  /* DUNNING AL-VUELO (10B, R8): antes de leer users.plan, el estado del ciclo
   * se reconcilia contra subscriptions/MP (ventanas vencidas → downgrade,
   * drift de cancelaciones, realineo del gating). Así el drift no sobrevive a
   * un solo render — la decisión del titular reemplaza al job nocturno mientras
   * no hay dominio/pg_cron. */
  try {
    // R12.2: el editor NUNCA consulta pagos en MP — mantiene el render rápido
    // y el PlanWatcher refresca por Realtime cuando el webhook/sync cambia el plan.
    await reconcileUserCycle(user.id, { mode: 'local' });
  } catch (e) {
    console.error('[reconcile editor]:', e instanceof Error ? e.message : e); // fail-soft: el render sigue
  }

  const { data } = await supabase
    .from('users')
    .select(
      'id, base_name, plan, grace_expires_at, brand_name, logo_thumb_url, deleted_at, whatsapp_e164, instagram_handle',
    )
    .eq('id', user.id)
    .maybeSingle<UserRecord>();

  if (data?.deleted_at) {
    redirect('/api/auth/exit?motivo=inhabilitada');
  }

  const rawPlan = data?.plan;
  const plan: Plan =
    rawPlan === 'pro' || rawPlan === 'pro_grace' ? rawPlan : 'free';

  // Thumb del logo para el header del taller (workspace: acá se ve SIEMPRE;
  // el white-label de OUTPUTS se decide en resolveBranding según el plan).
  const logoThumbUrl = data?.logo_thumb_url ? await signedBrandingUrl(data.logo_thumb_url) : null;

  const profile: ShellProfile = {
    exists: Boolean(data),
    baseName: data?.base_name || 'MI TALLER',
    brandName: data?.brand_name ?? null,
    plan,
    graceExpiresAt: data?.grace_expires_at ?? null,
    logoThumbUrl,
    // Pos 9 (R4): pie de la Ficha con CTA de WhatsApp + handle de Instagram.
    whatsappE164: data?.whatsapp_e164 ?? null,
    instagramHandle: data?.instagram_handle ?? null,
  };

  /* ── Proyecto inicial (server-side) ────────────────────────────────────────
   * `?project=` (desde «Mis enlaces») abre ESE proyecto, no el último. La
   * consulta usa la sesión + RLS y ADEMÁS filtra user_id: un id ajeno,
   * inexistente o malformado jamás se renderiza — se redirige al editor con
   * un aviso neutro (misma respuesta para todos los casos, sin enumerar).
   * El estado se normaliza acá y el diseño original se firma con service-role
   * SOLO después de confirmar que el proyecto es del usuario. */
  if (projectParam && !isProjectId(projectParam)) {
    redirect(
      initialPaywallOpen
        ? '/editor?proyecto=no-disponible&paywall=1'
        : '/editor?proyecto=no-disponible',
    );
  }

  let projectRow: { id: string; state: unknown; updated_at: string } | null = null;
  if (projectParam) {
    const requested = await supabase
      .from('projects')
      .select('id, state, updated_at')
      .eq('id', projectParam)
      .eq('user_id', user.id)
      .maybeSingle<{ id: string; state: unknown; updated_at: string }>();
    if (requested.error) {
      console.error('[editor project]:', requested.error.message);
    }
    if (!requested.data) {
      redirect(
        initialPaywallOpen
          ? '/editor?proyecto=no-disponible&paywall=1'
          : '/editor?proyecto=no-disponible',
      );
    }
    projectRow = requested.data;
  } else {
    const latest = await supabase
      .from('projects')
      .select('id, state, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; state: unknown; updated_at: string }>();
    if (latest.error) {
      console.error('[editor latest project]:', latest.error.message);
    }
    projectRow = latest.data ?? null;
  }

  let initialProject: InitialProject | null = null;
  if (projectRow) {
    const state = normalizeState(projectRow.state);
    let design: DesignSourceRef | null = null;
    try {
      design = await loadProjectDesignSource(createSupabaseServiceClient(), {
        userId: user.id,
        projectId: projectRow.id,
        // El original se guardó con el D_ext vigente al cargar el diseño;
        // sin metadata histórica usamos el diámetro actual del proyecto.
        baseSideMm: state.extDiameter,
      });
    } catch (e) {
      console.error('[editor design]:', e instanceof Error ? e.message : e);
    }
    initialProject = {
      projectId: projectRow.id,
      updatedAt: projectRow.updated_at,
      state,
      design,
    };
  }

  return (
    <EditorShell
      userId={user.id}
      profile={profile}
      initialPaywallOpen={initialPaywallOpen}
      legalVersions={LEGAL_VERSIONS}
      initialProject={initialProject}
      projectUnavailable={projectUnavailable}
    />
  );
}
