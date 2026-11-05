'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Camera,
  Check,
  ImageOff,
  Mail,
  MapPin,
  RefreshCw,
  Trash2,
  AtSign,
  Phone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DangerConfirm from '@/components/profile/danger-confirm';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  encodeLogo,
  LOGO_INLINE_MESSAGES,
  type LogoError,
} from '@/lib/encode-logo';
import {
  completionCopy,
  completionPct,
} from '@/lib/profile';
import { digitsOnly, initialsOf, normalizeInstagram, toE164 } from '@/lib/branding';

/* ==========================================================================
 * PANEL DE PERFIL — spec registro §4 (posición 2).
 * Tarjetas con guardado inline (sin toasts persistentes), indicador 5×20 %
 * calculado en cliente, pipeline de logo client-side y Zona de peligra R8.
 * ========================================================================== */

const WHATSAPP_PREFIXES: Record<string, string> = {
  '54': 'Argentina (+54)',
  '1': 'US / Canada (+1)',
  '55': 'Brasil (+55)',
  '56': 'Chile (+56)',
  '595': 'Paraguay (+595)',
  '591': 'Bolivia (+591)',
  '593': 'Ecuador (+593)',
  '598': 'Uruguay (+598)',
  '34': 'España (+34)',
  '39': 'Italia (+39)',
};

interface EditableFields {
  brandName: string;
  whatsappE164: string;
  instagramHandle: string;
  location: string;
}

interface LogoProps {
  stored: boolean;
  thumbViewUrl: string | null;
  fullViewUrl: string | null;
}

function splitE164(e164: string): { prefix: string; local: string } {
  const match = /^\+(\d{1,3})(\d+)$/.exec(e164.trim());
  if (!match) return { prefix: '54', local: '' };
  return { prefix: match[1]!, local: match[2]! };
}

/** Motivos del API (server) → el mismo mensaje inline del codificador. */
function reasonToMessage(status: number, payload: { error?: string; reason?: string }): string {
  if (status === 503) return 'El Storage estaba caído: no se guardó nada y tu logo anterior sigue a salvo.';
  if (status === 500) return 'El archivo quedó en tu espacio del workspace, pero no pudimos anotarlo en tu perfil — probá de nuevo.';
  if (status === 401) return 'Tu sesión expiró — refrescá la página e iniciá sesión otra vez.';
  switch (payload.reason) {
    case 'format':
      return LOGO_INLINE_MESSAGES.format;
    case 'decode':
      return LOGO_INLINE_MESSAGES.decode;
    case 'dims':
      return 'Las dimensiones no cumplen (≤512 px · thumb 144×144): reencodá y probá de nuevo.';
    case 'size':
      return LOGO_INLINE_MESSAGES.size;
    default:
      return 'No pudimos guardar el logo — reintentá en un momento.';
  }
}

export default function ProfilePanel({
  userId,
  displayName,
  emailVerified,
  initial,
  logo,
}: {
  userId: string;
  displayName: string;
  emailVerified: boolean;
  initial: EditableFields;
  logo: LogoProps;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [brandName, setBrandName] = useState(initial.brandName);
  const W = splitE164(initial.whatsappE164);
  const [waPrefix, setWaPrefix] = useState(W.prefix);
  const [waDigits, setWaDigits] = useState(W.local);
  const [instagramRaw, setInstagramRaw] = useState(
    initial.instagramHandle ? `@${initial.instagramHandle}` : '',
  );
  const [location, setLocation] = useState(initial.location);

  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const [fieldError, setFieldError] = useState<Record<string, string | null>>({});
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const flashTimer = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const instagram = normalizeInstagram(instagramRaw);
  const whatsappE164 = toE164(waPrefix, waDigits);
  const whatsappInvalid = waDigits.length > 0 && !whatsappE164;
  const instagramInvalid = instagramRaw.trim().length > 0 && !instagram;

  const completeness = {
    logoUrl: logo.stored ? 'set' : null,
    whatsappE164: whatsappE164,
    brandName: brandName,
    instagramHandle: instagram,
    location: location,
  };
  const pct = completionPct(completeness);

  function doFlash(key: string) {
    clearTimeout(flashTimer.current.get(key));
    setFlash((prev) => ({ ...prev, [key]: true }));
    flashTimer.current.set(
      key,
      setTimeout(() => setFlash((prev) => ({ ...prev, [key]: false })), 1600),
    );
  }

  async function saveField(key: string, patch: Record<string, string | null>) {
    setFieldError((prev) => ({ ...prev, [key]: null }));
    const { error } = await supabase.from('users').update(patch).eq('id', userId);
    if (error) {
      setFieldError((prev) => ({ ...prev, [key]: error.message }));
      return;
    }
    doFlash(key);
    router.refresh();
  }

  async function saveLogo(file?: File | null) {
    if (!file) return;
    setLogoError(null);
    setLogoBusy(true);
    try {
      const encoded = await encodeLogo(file);
      const body = new FormData();
      body.set('main', encoded.main, `logo.${encoded.mime === 'image/webp' ? 'webp' : 'png'}`);
      body.set('thumb', encoded.thumb, `logo_thumb.${encoded.mime === 'image/webp' ? 'webp' : 'png'}`);
      const res = await fetch('/api/profile/logo', { method: 'POST', body });
      const payload = await res.json().catch(() => ({}) as { error?: string; reason?: string });
      if (!res.ok) throw new Error(reasonToMessage(res.status, payload));
      doFlash('logo');
      router.refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : LOGO_INLINE_MESSAGES.decode);
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoError(null);
    setLogoBusy(true);
    try {
      const res = await fetch('/api/profile/logo', { method: 'DELETE' });
      if (!res.ok) throw new Error('No pudimos quitar el logo — reintentá.');
      doFlash('logo');
      router.refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'No pudimos quitar el logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    try {
      const res = await fetch('/api/profile/delete', { method: 'POST' });
      if (!res.ok) throw new Error('No pudimos ejecutar la eliminación — reintentá.');
      // cold path: unlockedsession ya se mató server-side
      setTimeout(() => router.replace('/auth?cuenta=eliminada'), 400);
    } catch (err) {
      setFieldError((prev) => ({ ...prev, delete: err instanceof Error ? err.message : String(err) }));
      setDeleteBusy(false);
      setDangerOpen(true);
    }
  }

  const initialsPreview = initialsOf(brandName.trim() || displayName);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 pb-12">
      {/* ---------------------------------------------------------------- */}
      {/* Header: identidad + estado de verificación (R7, derivada de auth) */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {logo.thumbViewUrl ? (
            <img
              src={logo.thumbViewUrl}
              alt="Logo del taller"
              className="h-11 w-11 rounded-xl border border-gold/30 object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/30 bg-white/5 text-sm font-bold text-gold-soft">
              {initialsOf(displayName)}
            </div>
          )}
          <div className="leading-tight">
            <h1 className="text-lg font-bold text-cream">Perfil del taller</h1>
            <p className="text-[11px] text-stone-500">Los datos de acá alimentan fichas, visor y enlaces.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push('/editor')}>
          ← Volver al editor
        </Button>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Indicador 5 × 20 % con copy dinámico (§4)                         */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Perfil configurado
          </h2>
          <span className="text-sm font-bold text-gold-soft">{pct} %</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-strong to-gold-soft transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-stone-500">{completionCopy(completeness)}</p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Logo (R4): re-encodado en cliente; preview del editable exact     */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
              <Camera className="h-3.5 w-3.5" /> Logo del taller
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
              PNG, JPG o SVG hasta 2 MB. Ajustamos a webp ≤512 px + miniatura 144 (el original
              nunca se guarda). En el editor lo ves siempre; en fichas y enlaces es white-label
              de plan <b className="text-gold-soft">PRO</b>.
            </p>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void saveLogo(e.dataTransfer.files?.[0]);
            }}
            className={`flex h-24 w-24 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
              dragOver ? 'border-gold/60 bg-gold/10' : 'border-white/10 bg-black/30'
            }`}
          >
            {logoBusy ? (
              <RefreshCw className="h-5 w-5 animate-spin text-gold-soft" />
            ) : logo.thumbViewUrl ? (
              <img
                src={logo.thumbViewUrl}
                alt="Logo actual"
                className="h-24 w-24 object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 px-2 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/30 bg-white/5 text-xs font-bold text-gold-soft">
                  {initialsPreview}
                </div>
                <span className="text-[9px] leading-tight text-stone-600">
                  Se mostrarán tus iniciales
                </span>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden"
          onChange={(e) => void saveLogo(e.target.files?.[0])}
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={logoBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {logo.stored ? 'Reemplazar' : 'Subir'}
          </Button>
          {logo.stored && (
            <Button variant="ghost" size="sm" disabled={logoBusy} onClick={() => void removeLogo()}>
              <ImageOff className="h-3.5 w-3.5" /> Quitar
            </Button>
          )}
          {flash.logo && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
              <Check className="h-3 w-3" /> Actualizado ✓
            </span>
          )}
        </div>
        {logoError && <p className="mt-2 text-[11px] text-amber-300">{logoError}</p>}
      </section>

      {/* Nombre comercial (R3: prefilled con el derivado) ------------------ */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
          Nombre comercial
        </h3>
        <p className="mt-1 text-[11px] text-stone-500">
          Se imprime en fichas y enlaces. Tu derivado de registro es{' '}
          <b className="text-stone-300">{displayName || 'MI TALLER'}</b> y queda como fallback.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Firma de tu taller"
            maxLength={60}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={brandName.trim() === initial.brandName}
            onClick={() =>
              void saveField('brandName', { brand_name: brandName.trim() || null })
            }
          >
            Guardar
          </Button>
        </div>
        <FieldFooter flash={flash.brandName} error={fieldError.brandName} />
      </section>

      {/* WhatsApp (E.164, prefijo +54 default) ----------------------------- */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
          <Phone className="h-3.5 w-3.5" /> WhatsApp
        </h3>
        <p className="mt-1 text-[11px] text-stone-500">
          Así llega la CTA de aprobación en fichas y visor (10–15 dígitos totales con prefijo).
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={waPrefix}
            onChange={(e) => setWaPrefix(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-cream outline-none focus:border-gold/60 sm:w-52"
          >
            {Object.entries(WHATSAPP_PREFIXES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <Input
            value={waDigits}
            onChange={(e) => setWaDigits(digitsOnly(e.target.value))}
            placeholder="11 2345 6789"
            inputMode="numeric"
            maxLength={13}
            invalid={whatsappInvalid}
            className="sm:flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!whatsappE164 || whatsappE164 === initial.whatsappE164}
            onClick={() =>
              whatsappE164 && void saveField('whatsapp', { whatsapp_e164: whatsappE164 })
            }
          >
            Guardar
          </Button>
        </div>
        {whatsappInvalid && (
          <p className="mt-2 text-[11px] text-amber-300">
            Faltan dígitos / prefijo incorrecto — no se guarda el valor inválido.
          </p>
        )}
        <FieldFooter flash={flash.whatsapp} error={fieldError.whatsapp} />
      </section>

      {/* Instagram (normaliza a minúsculas sin @) -------------------------- */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
          <AtSign className="h-3.5 w-3.5" /> Instagram
        </h3>
        <p className="mt-1 text-[11px] text-stone-500">
          Se etiqueta en la ficha. Si falta, la fila sale oculta (R3).
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={instagramRaw}
            onChange={(e) => setInstagramRaw(e.target.value)}
            onBlur={(e) => setInstagramRaw((v) => (v.trim() ? `@${normalizeInstagram(v) ?? v.replace(/^@+/, '')}` : ''))}
            placeholder="@taller.delvalle"
            maxLength={31}
            invalid={instagramInvalid}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={instagramInvalid || instagram === initial.instagramHandle}
            onClick={() => void saveField('instagram', { instagram_handle: instagram })}
          >
            Guardar
          </Button>
        </div>
        {instagramInvalid && (
          <p className="mt-2 text-[11px] text-amber-300">
            Caracteres no permitidos — usa letras, números, puntos y guion bajo.
          </p>
        )}
        <FieldFooter flash={flash.instagram} error={fieldError.instagram} />
      </section>

      {/* Ubicación (R2: SOLO perfil interno) -------------------------------- */}
      <section className="rounded-xl border border-line bg-panel p-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-400">
          <MapPin className="h-3.5 w-3.5" /> Ubicación
        </h3>
        <p className="mt-1 text-[11px] text-stone-500">
          <b className="text-stone-300">Solo para tu perfil</b> — ningún output la imprime.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Ciudad, provincia"
            maxLength={80}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={location.trim() === initial.location}
            onClick={() => void saveField('location', { location: location.trim() || null })}
          >
            Guardar
          </Button>
        </div>
        <FieldFooter flash={flash.location} error={fieldError.location} />
      </section>

      {/* Email verificado (R7): derivado de auth, info de pago en 8–10 ----- */}
      <section className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-[11px] text-stone-400">
        <Mail className="h-3.5 w-3.5 text-stone-500" />
        {emailVerified ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <BadgeCheck className="h-3.5 w-3.5" /> Email verificado.
          </span>
        ) : (
          <span>Sin verificar — se exige recién cuando pagás un plan PRO (R7).</span>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Zona de peligro (R8)                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-rose-500/20 bg-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="leading-tight">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-200">
              Zona de peligro
            </h3>
            <p className="mt-1 text-[11px] text-stone-500">
              Eliminar cuenta borra proyectos y diseños al instante; la fila queda 30 días
              restaurable por soporte desde este email.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDangerOpen(true)}
            className="shrink-0 text-rose-300 hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Eliminar cuenta
          </Button>
        </div>
        {fieldError.delete && (
          <p className="mt-2 text-[11px] text-amber-300">{fieldError.delete}</p>
        )}
      </section>

      <DangerConfirm
        open={dangerOpen}
        busy={deleteBusy}
        onCancel={() => !deleteBusy && setDangerOpen(false)}
        onConfirm={() => void deleteAccount()}
      />
    </div>
  );
}

function FieldFooter({ flash, error }: { flash?: boolean; error?: string | null }) {
  if (error) return <p className="mt-2 text-[11px] text-amber-300">{error}</p>;
  if (flash)
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-400">
        <Check className="h-3 w-3" /> Guardado ✓
      </p>
    );
  return null;
}
