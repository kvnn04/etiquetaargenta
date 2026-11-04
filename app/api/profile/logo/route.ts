import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  BRANDING_BUCKET,
  createSupabaseServiceClient,
  ensureBrandingBucket,
} from '@/lib/supabase/service';

/**
 * POST /api/profile/logo — subida/reemplazo del logo (spec registro §3-R4).
 * El CLIENTE encoda (webp/png ≤512 px + thumb 144); acá NO se confía: se
 * valida magia de bytes + dimensiones reales + cotas. Todo o nada: si algo
 * falla no se toca la fila ni el bucket.
 * DELETE — quita el logo (assets + columnas a null).
 */

const MAX_MAIN_BYTES = 150 * 1024;
const MAX_THUMB_BYTES = 40 * 1024;
const MAX_MAIN_SIDE = 512;
const THUMB_SIDE = 144;

type ImageFormat = 'image/webp' | 'image/png';

function bytesOf(view: ArrayBuffer): Uint8Array {
  return new Uint8Array(view);
}

/** Parser chico de dimensiones WebP/PNG: no confiamos en lo que el cliente declara. */
function imageDims(bytes: Uint8Array): { width: number; height: number; mime: ImageFormat } | null {
  const ascii = (bytes: Uint8Array, from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));

  // PNG: mágico \x89PNG\r\n\x1a\n + IHDR
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    bytes.length >= 24
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' };
  }

  // WebP: RIFF....WEBP + chunk VP8X / VP8L / "VP8 "
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' && bytes.length >= 30) {
    const code = ascii(bytes, 12, 16);
    const payload = 20; // 12 header + 4 code + 4 size
    if (code === 'VP8X') {
      const width = 1 + ((bytes[payload + 4] | (bytes[payload + 5] << 8) | (bytes[payload + 6] << 16)));
      const height = 1 + ((bytes[payload + 7] | (bytes[payload + 8] << 8) | (bytes[payload + 9] << 16)));
      return { width, height, mime: 'image/webp' };
    }
    if (code === 'VP8L' && bytes[payload] === 0x2f) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset);
      const bits = dv.getUint32(payload + 1, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: 'image/webp' };
    }
    if (code === 'VP8 ') {
      const isLossy = bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a;
      if (isLossy) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset);
        return {
          width: (dv.getUint16(payload + 6, true) & 0x3fff) + 1,
          height: (dv.getUint16(payload + 8, true) & 0x3fff) + 1,
          mime: 'image/webp',
        };
      }
    }
  }
  return null;
}

/**
 * POST: multipart { main, thumb }.
 * 200 ⇒ { ok: true, logoUrl, logoThumbUrl } (paths guardados en la fila).
 * 400 con { reason: 'format'|'dims'|'size'|'decode' } ⇒ rechazo inline.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'decode' }, { status: 400 });
  }

  const main = form.get('main');
  const thumb = form.get('thumb');
  if (!(main instanceof File) || !(thumb instanceof File) || main.size === 0 || thumb.size === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST', reason: 'decode' }, { status: 400 });
  }

  const mainBytes = bytesOf(await main.arrayBuffer());
  const thumbBytes = bytesOf(await thumb.arrayBuffer());

  const mainInfo = imageDims(mainBytes);
  const thumbInfo = imageDims(thumbBytes);
  if (!mainInfo || !thumbInfo) {
    return NextResponse.json({ error: 'IMAGEN_ILEGIBLE', reason: 'format' }, { status: 400 });
  }

  const within = (side: number, max: number) => side > 0 && side <= max;
  if (!within(mainInfo.width, MAX_MAIN_SIDE) || !within(mainInfo.height, MAX_MAIN_SIDE)) {
    return NextResponse.json({ error: 'COTA_EXCEDIDA', reason: 'dims' }, { status: 400 });
  }
  if (thumbInfo.width !== THUMB_SIDE || thumbInfo.height !== THUMB_SIDE) {
    return NextResponse.json({ error: 'THUMB_INVALIDO', reason: 'dims' }, { status: 400 });
  }
  if (main.size > MAX_MAIN_BYTES || thumb.size > MAX_THUMB_BYTES) {
    return NextResponse.json({ error: 'PESO_EXCEDIDO', reason: 'size' }, { status: 400 });
  }

  if (!(await ensureBrandingBucket())) {
    return NextResponse.json({ error: 'STORAGE_INDISPONIBLE' }, { status: 503 });
  }

  const ext = mainInfo.mime === 'image/webp' ? 'webp' : 'png';
  const bucketPath = (name: string) => `${user.id}/${name}`;

  const service = createSupabaseServiceClient();
  const storage = service.storage.from(BRANDING_BUCKET);

  try {
    const [up1, up2] = await Promise.all([
      storage.upload(bucketPath(`logo.${ext}`), mainBytes, {
        contentType: mainInfo.mime,
        cacheControl: '86400',
        upsert: true,
      }),
      storage.upload(bucketPath(`logo_thumb.${ext}`), thumbBytes, {
        contentType: thumbInfo.mime,
        cacheControl: '86400',
        upsert: true,
      }),
    ]);
    if (up1.error || up2.error) throw up1.error ?? up2.error;

    // limpieza de variantes previas de otro formato (png→webp): nada huérfano
    const { data: objects } = await storage.list(user.id);
    const stale = (objects ?? []).filter(
      (o) => o.name !== `logo.${ext}` && o.name !== `logo_thumb.${ext}`,
    );
    if (stale.length > 0) {
      await storage.remove(stale.map((o) => `${user.id}/${o.name}`));
    }

    const logoUrl = `branding/${bucketPath(`logo.${ext}`)}`;
    const logoThumbUrl = `branding/${bucketPath(`logo_thumb.${ext}`)}`;

    const { error: updateError } = await service
      .from('users')
      .update({ logo_url: logoUrl, logo_thumb_url: logoThumbUrl })
      .eq('id', user.id);
    if (updateError) throw new Error(`users update: ${updateError.message}`);

    return NextResponse.json({ ok: true, logoUrl, logoThumbUrl });
  } catch (err) {
    console.error('[profile/logo]:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'STORAGE_INDISPONIBLE' }, { status: 503 });
  }
}

/** DELETE: quita assets + columnas (view del panel regresa al fallback). */
export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

  const service = createSupabaseServiceClient();
  const { error: updateError } = await service
    .from('users')
    .update({ logo_url: null, logo_thumb_url: null })
    .eq('id', user.id);
  if (updateError) {
    console.error('[profile/logo DELETE]', updateError.message);
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 });
  }

  const storage = service.storage.from(BRANDING_BUCKET);
  const { data: objects } = await storage.list(user.id);
  if (objects && objects.length > 0) {
    await storage.remove(objects.map((o) => `${user.id}/${o.name}`));
  }

  return NextResponse.json({ ok: true });
}
