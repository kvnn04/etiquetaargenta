import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { planOf, type ExportsPlan } from '@/lib/exports/ticket-server';
import { normalizeScale } from '@/lib/overflow';
import {
  LINK_VARIANTS_MAX,
  isLinkVariantId,
  isPublishableDraft,
  normalizeVariantLabel,
  rotationDegPayload,
  buildLinkPayload,
  type LinkMateConfigBlock,
  type LinkVariantDraft,
  type LinkVariantId,
} from '@/lib/links/payload';
import { generateUniqueLinkId } from '@/lib/links/identity';
import { canonicalLinkUrl, LINK_TTL_MS, whatsappShareHref, whatsappShareText } from '@/lib/links/states';

/* ============================================================================
 * /api/links — PUBLICADOR DE ENLACES COMERCIALES (posición 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md
 *   §3-R8 (paywall server-side: FREE ⇒ 402, plan autoritativo), §3-R3
 *   (assets re-encodados a Storage, payload liviano), §3-R1/R2 (linkId nuevo
 *   por versión + versionado inmutable), §6 (validaciones de publicación).
 * ----------------------------------------------------------------------------
 * Flujo del POST (publicar):
 *   1. Sesión por cookies (getUser) ⇒ 401.
 *   2. Plan desde `users` con SERVICE-ROLE (el claim del JWT es cache NO
 *      autoritativa). FREE ⇒ 402 'PAYWALL_REQUIRED' con capability
 *      links.generate — la UI abre el Paywall (patrón pos 8/9: nadie decide
 *      en el cliente).
 *   3. Valida el draft (≥1 y ≤3 variantes / ids únicos A–C / labels ≤40) y el
 *      ownership del proyecto (fail-closed: la fila tiene que ser SUYA).
 *   4. El mateConfig del payload (R4) SE CONSTRUYE DESDE projects.state
 *      server-side — el cliente no manda config: lo congelado es la DB.
 *   5. Genera linkId R2 con reintentos de colisión (consulta live).
 *   6. Sube los assets con service-role:
 *        · textura re-encodada ≤300 KB (R3): link-assets/{linkId}/design.ext
 *          (bucket PÚBLICO de lectura — el cliente la baja sin sesión);
 *        · logo del taller congelo por VERSIÓN: link-assets/{linkId}/logo.png
 *          (cada versión congelá SU branding, R1);
 *        · ORIGINAL del grabado: designs/{userId}/{projectId}.ext (bucket
 *          PRIVADO — decisión 10A: regenerar en sesiones futuras).
 *   7. INSERT con service-role (R1: las versiones son INMUTABLES — jamás un
 *      UPDATE de payload; created_by_pro siempre true porque el 402 filtra).
 *   8. QA registro en consola + 200 {linkId, url, expiresAt, version, …}.
 * GET ?projectId=… — versiones del proyecto (solo dueño) con agregados de
 *   aprobaciones (R6) para los badges del panel del editor.
 * ============================================================================ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // sesión por cookies: nada de cache

/* Cotas de la spec §3-R3/§6 (bytes EXACTOS tras decodificar el base64). */
const TEXTURE_MAX_BYTES = 300 * 1024; // ≤300 KB (R3)
const ORIGINAL_MAX_BYTES = 10 * 1024 * 1024; // tope del bucket `designs` (0004)
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);
const LINK_ASSETS_BUCKET = 'link-assets';
const DESIGNS_BUCKET = 'designs';

/** Extensión de archivo a partir del mime (solo los 4 permitidos). */
function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'bin';
  }
}

function decodeBase64(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Tolerar wrapper data-URL por sanidad (el cliente manda base64 pelado).
  const b64 = raw.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (b64.length > 0 && buf.length === 0) return null; // base64 roto
  return buf.length > 0 ? buf : null;
}

/** Columnas de `users` que alimenta el bloque workshop del payload (R4). */
interface ProfileRow {
  base_name?: string | null; // nombre derivado del email (pos 1)
  brand_name?: string | null; // nombre comercial (pos 2)
  logo_path?: string | null; // PATH en branding/{uid}/... (pos 2)
  whatsapp_e164?: string | null; // E.164 (pos 9)
  instagram_handle?: string | null;
}

/** Claves exactas del jsonb projects.state que arman el mateConfig (R4). */
interface ProjectStateRow {
  mateModel?: unknown;
  extDiameter?: unknown;
  intDiameter?: unknown;
  metalPreset?: unknown;
  virolaColor?: unknown;
  bodyPreset?: unknown;
  bodyColor?: unknown;
}

function buildMateConfigFromState(state: unknown): LinkMateConfigBlock {
  const s = (state ?? {}) as ProjectStateRow;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  const hex = (v: unknown): string | null =>
    typeof v === 'string' && v.startsWith('#') ? v.toUpperCase() : null;
  const preset = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.length > 0 ? v : fallback;
  return {
    model: preset(s.mateModel, 'camionero'), // R4/R8: desconocido ⇒ camionero en el visor
    extDiameter: num(s.extDiameter, 123),
    intDiameter: num(s.intDiameter, 95),
    metal: preset(s.metalPreset, 'alpaca'),
    virolaColor: hex(s.virolaColor), // null ⇒ el visor cae al preset (compat R6 pos 5)
    topFaceColor: null, // campo de compat con payload legacy: los nuevos SIEMPRE lo traen null
    cupMaterial: preset(s.bodyPreset, 'algarrobo'),
    cupColor: hex(s.bodyColor),
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const resolved = await planOf(user.id);
  const plan: ExportsPlan = resolved ?? 'free'; // fail-closed: sin fila ⇒ free
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'PAYWALL_REQUIRED', capability: 'links.generate' },
      { status: 402 },
    );
  }

  const body = (await request.json().catch(() => null)) as PublishBody | null;
  if (!body || typeof body.projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.projectId)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'project_id' }, { status: 400 });
  }
  if (!Array.isArray(body.variants)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variants' }, { status: 400 });
  }

  /* ── Draft de variantes: raw del cliente ⇒ normalizado server ──────────── */
  const drafts: LinkVariantDraft[] = [];
  for (const rawVariant of body.variants.slice(0, LINK_VARIANTS_MAX)) {
    const candidate = (rawVariant ?? {}) as Record<string, unknown>;
    if (!isLinkVariantId(candidate.id)) {
      return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variant_id' }, { status: 400 });
    }
    drafts.push({
      id: candidate.id as LinkVariantId,
      label: normalizeVariantLabel(candidate.label),
      // % canónico del editor (normalizeScale re-fija [70..110] paso 0.5%)
      scalePct: normalizeScale(candidate.scalePct),
      rotationDeg: rotationDegPayload(candidate.rotationDeg),
      mirror: Boolean(candidate.mirror),
    });
  }
  if (!isPublishableDraft(drafts)) {
    // ≥1 y ≤3 variantes, ids únicos, labels no vacíos
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'variants' }, { status: 400 });
  }

  /* ── Assets del publish (R3): textura ≤300 KB + original del proyecto ──── */
  const textureBytes = decodeBase64(body.design?.textureBase64);
  if (!textureBytes || textureBytes.length > TEXTURE_MAX_BYTES) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', reason: 'texture', maxBytes: TEXTURE_MAX_BYTES },
      { status: 400 },
    );
  }
  // Sin original (e.g., asset reconstruido) ⇒ la textura hace de original.
  const originalBytes = decodeBase64(body.design?.originalBase64) ?? textureBytes;
  if (originalBytes.length > ORIGINAL_MAX_BYTES) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', reason: 'original', maxBytes: ORIGINAL_MAX_BYTES },
      { status: 400 },
    );
  }
  const textureMime =
    typeof body.design?.textureMime === 'string' && ALLOWED_IMAGE_MIMES.has(body.design.textureMime)
      ? body.design.textureMime
      : 'image/png';
  const originalMime =
    typeof body.design?.originalMime === 'string' && ALLOWED_IMAGE_MIMES.has(body.design.originalMime)
      ? body.design.originalMime
      : textureMime;

  const service = createSupabaseServiceClient();

  /* ── Ownership + estado CONGELADO (fail-closed) ─────────────────────────── */
  const owned = await service
    .from('projects')
    .select('id, state')
    .eq('id', body.projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; state: unknown }>();
  if (owned.error) {
    // Pos 10A QA: este error tragado fue el diagnóstico del 404 mudo del
    // publish (grants faltantes = "permission denied for table projects", ops/0910).
    console.error('[links ownership]:', owned.error.message);
  }
  if (owned.error || !owned.data) {
    return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  }

  /* ── Branding del taller → workshop (cada versión congela SU marca, R1) ── */
  const profile = (await service
    .from('users')
    .select('base_name, brand_name, logo_path, whatsapp_e164, instagram_handle')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>())?.data;
  const workshopName = (profile?.brand_name?.trim() || profile?.base_name || '').trim();
  const origin = request.nextUrl.origin;

  /* ── linkId R2 sin colisión (consulta live sobre links) ─────────────────── */
  let linkId: string;
  try {
    linkId = await generateUniqueLinkId(async (candidate) => {
      const hit = await service
        .from('links')
        .select('link_id')
        .eq('link_id', candidate)
        .maybeSingle<{ link_id: string }>();
      return Boolean(hit.data);
    });
  } catch {
    return NextResponse.json({ error: 'LINK_ID_EXHAUSTED' }, { status: 503 });
  }

  /* ── Versionado R1: max(version) + 1 del proyecto ───────────────────────── */
  const lastVersion = await service
    .from('links')
    .select('version')
    .eq('user_id', user.id)
    .eq('project_id', body.projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  /* ── Storage (service-role): publicar, jamás editar (R1) ────────────────── */
  const texturePath = `${linkId}/design.${extForMime(textureMime)}`;
  const textureUpload = await service.storage
    .from(LINK_ASSETS_BUCKET)
    .upload(texturePath, new Uint8Array(textureBytes), {
      contentType: textureMime,
      upsert: true,
    });
  if (textureUpload.error) {
    console.error('[links publish texture]:', textureUpload.error.message);
    return NextResponse.json({ error: 'STORAGE_UNAVAILABLE' }, { status: 503 });
  }
  const assetUrl = service.storage.from(LINK_ASSETS_BUCKET).getPublicUrl(texturePath).data.publicUrl;

  const originalPath = `${user.id}/${body.projectId}.${extForMime(originalMime)}`;
  const originalUpload = await service.storage
    .from(DESIGNS_BUCKET)
    .upload(originalPath, new Uint8Array(originalBytes), {
      contentType: originalMime,
      upsert: true, // un original por proyecto (el último publish lo reemplaza)
    });
  if (originalUpload.error) console.error('[links publish original]:', originalUpload.error.message);

  /* Logo congelado por versión: copia PÚBLICA del thumb privado (R1) — un
   * fallo acá DEGRADA a iniciales (fallback de la spec usuario), no bloquea. */
  let logoUrl: string | null = null;
  const logoPath = profile?.logo_path;
  if (typeof logoPath === 'string' && logoPath.startsWith('branding/')) {
    try {
      const logoBlob = await service.storage.from('branding').download(logoPath.replace(/^branding\//, ''));
      if (logoBlob.data) {
        const logoBytes = new Uint8Array(await logoBlob.data.arrayBuffer());
        const logoUpload = await service.storage
          .from(LINK_ASSETS_BUCKET)
          .upload(`${linkId}/logo.png`, logoBytes, { contentType: 'image/png', upsert: true });
        if (!logoUpload.error) {
          logoUrl = service.storage.from(LINK_ASSETS_BUCKET).getPublicUrl(`${linkId}/logo.png`).data.publicUrl;
        }
      }
    } catch (err) {
      console.error('[links publish logo]:', err instanceof Error ? err.message : err);
    }
  }

  /* ── Payload R4 + fila inmutable ──────────────────────────────────────── */
  const nowMs = Date.now();
  const payload = buildLinkPayload({
    linkId,
    nowMs,
    expiresMs: nowMs + LINK_TTL_MS,
    workshop: {
      name: workshopName || 'MI TALLER',
      logoUrl,
      whatsapp: (profile?.whatsapp_e164 ?? '').replace(/[^0-9]/g, '') || null,
      instagram: profile?.instagram_handle?.trim() || null,
    },
    mateConfig: buildMateConfigFromState(owned.data.state), // desde la DB, jamás del cliente
    variants: drafts,
    assetUrl,
  });

  const insert = await service
    .from('links')
    .insert({
      link_id: linkId,
      project_id: body.projectId,
      user_id: user.id,
      version: (lastVersion.data?.version ?? 0) + 1,
      payload,
      expires_at: payload.expiresAt,
      created_by_pro: true, // este route solo lo alcanza pro/pro_grace (402 arriba)
    })
    .select('link_id, version, expires_at')
    .single();
  if (insert.error || !insert.data) {
    console.error('[links publish insert]:', insert.error?.message);
    return NextResponse.json({ error: 'LINK_UNAVAILABLE' }, { status: 503 });
  }

  /* QA registro (mismo espíritu del módulo exports): el publish queda rastreado */
  console.log(
    '[links QA registro]',
    JSON.stringify({ user: user.id, plan, artifact: 'link', linkId, at: new Date(nowMs).toISOString() }),
  );

  const url = canonicalLinkUrl(insert.data.link_id, origin);
  return NextResponse.json({
    ok: true as const,
    linkId: insert.data.link_id,
    version: insert.data.version,
    expiresAt: insert.data.expires_at,
    url,
    message: whatsappShareText(url),
    whatsappHref: whatsappShareHref(profile?.whatsapp_e164 ?? null, url),
  });
}

/* -------------------------------------------------------------------------- */
/* GET ?projectId=… — versiones del proyecto para el panel del editor          */
/* -------------------------------------------------------------------------- */

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const projectId = request.nextUrl.searchParams.get('projectId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'project_id' }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const owned = await service
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>();
  if (owned.error) {
    // Misma visibilidad que el POST: grants faltantes jamás vuelven a 404 mudo.
    console.error('[links ownership]:', owned.error.message);
  }
  if (owned.error || !owned.data) {
    return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  }

  const rows = await service
    .from('links')
    .select('link_id, version, created_at, expires_at')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (rows.error) {
    console.error('[links list]:', rows.error.message);
    return NextResponse.json({ error: 'LINKS_UNAVAILABLE' }, { status: 503 });
  }

  /* Aggregados R6 para los badges del panel: total + última aprobación por link */
  const linkIds = (rows.data ?? []).map((r) => r.link_id);
  const approvals = linkIds.length
    ? await service
        .from('link_approvals')
        .select('link_id, variant_id, approved_at')
        .in('link_id', linkIds)
        .order('approved_at', { ascending: false })
        .limit(1000)
    : { data: [] as Array<{ link_id: string; variant_id: string; approved_at: string }>, error: null };

  const perLink = new Map<string, { count: number; lastVariant: string | null; lastAt: string | null }>();
  for (const ap of (approvals.data ?? []) as Array<{
    link_id: string;
    variant_id: string;
    approved_at: string;
  }>) {
    const acc = perLink.get(ap.link_id) ?? { count: 0, lastVariant: null, lastAt: null };
    acc.count += 1;
    if (!acc.lastVariant) {
      acc.lastVariant = ap.variant_id;
      acc.lastAt = ap.approved_at;
    }
    perLink.set(ap.link_id, acc);
  }

  return NextResponse.json({
    ok: true as const,
    versions: (rows.data ?? []).map((r) => ({
      linkId: r.link_id,
      version: r.version,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      approvalsCount: perLink.get(r.link_id)?.count ?? 0,
      lastApprovedVariant: perLink.get(r.link_id)?.lastVariant ?? null,
      lastApprovedAt: perLink.get(r.link_id)?.lastAt ?? null,
    })),
  });
}

/* formas del body (local al archivo) — la validación vive DENTRO del handler */
interface PublishDesignBody {
  originalBase64?: unknown;
  originalMime?: unknown;
  textureBase64?: unknown;
  textureMime?: unknown;
}
interface PublishBody {
  projectId?: unknown;
  variants?: unknown;
  design?: PublishDesignBody;
}
