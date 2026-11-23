'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import LegalFooter from '@/components/legal/legal-footer';

/**
 * Auth Overlay (spec_autenticacion_y_modelo_freemium.md §4):
 * - Google OAuth principal + email/contraseña + '¿Olvidaste tu contraseña?' visible.
 * - Registro de 2 campos (R1 de la spec de usuario): el nombre de taller
 *   NO se pide — lo deriva el trigger `handle_new_user` en la base.
 * - Failures inline, sin estados rotos; al éxito aterrizá en el editor (§7.1).
 */
type Mode = 'signin' | 'signup' | 'recover';

const VALUE_PROP =
  'Diseñá y mostrá mates 3D hiperrealistas a tus clientes en segundos. Probá tu primer diseño gratis.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CAMPOS_COPY: Record<Mode, { heading: string; submit: string }> = {
  signin: { heading: 'Iniciá sesión', submit: 'Entrar' },
  signup: { heading: 'Creá tu cuenta gratis', submit: 'Crear cuenta' },
  recover: { heading: 'Restablecer contraseña', submit: 'Enviar instrucciones' },
};

export default function AuthOverlay({ banner }: { banner?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function resetMessages() {
    setError(null);
    setNotice(null);
    setPasswordError(null);
  }

  async function handleGoogle() {
    resetMessages();
    setGoogleBusy(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    setGoogleBusy(false);
    // En OAuth el éxito navega fuera; si volvió, hubo error:
    if (err) setError('No pudimos iniciar sesión con Google. Probá con tu email.');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    resetMessages();

    if (!EMAIL_RE.test(email)) {
      setError('Ingresá un email válido.');
      return;
    }
    if (mode !== 'recover' && password.length < 8) {
      setPasswordError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (err) {
          if (err.message.toLowerCase().includes('already')) {
            setMode('signin');
            setError('Ese email ya tiene una cuenta. Iniciá sesión.');
          } else {
            setError('No pudimos crear la cuenta. Reintentá en un momento.');
          }
          return;
        }
        if (data.session) {
          router.replace('/editor');
          router.refresh();
          return;
        }
        // Supabase pide confirmación de email (config del proyecto):
        // la regla de producto es "fricción cero" (confirm OFF salvo al pagar).
        setNotice('Cuenta creada. Si tu proyecto exige confirmación, revisá tu correo.');
        return;
      }

      if (mode === 'recover') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (err) {
          setError('No pudimos enviar el correo. Reintentá en un momento.');
          return;
        }
        // Mensaje neutro: no revela si la cuenta existe (anti-enumeración §6).
        setNotice('Si la dirección existe, enviamos un correo con los pasos para restablecer.');
        return;
      }

      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        if (err.message.toLowerCase().includes('invalid')) {
          setError('Email o contraseña incorrecta.');
        } else if (err.message.toLowerCase().includes('not confirmed')) {
          setError('Falta confirmar este email. Buscá el correo de activación.');
        } else {
          setError('No pudimos entrar. Reintentá en un momento.');
        }
        return;
      }
      router.replace('/editor');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const copy = CAMPOS_COPY[mode];

  return (
    <main className="flex min-h-screen">
      {/* Panel de valor (decorativo) */}
      <section className="relative hidden flex-1 lg:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 50% 38%, #292521 0%, #171719 45%, #090a0d 100%)',
          }}
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold/30 bg-white/5 font-bold text-gold-soft">
              M
            </div>
            <span className="text-xs font-bold uppercase tracking-[.2em] text-gold-soft">
              MOCAP 3D
            </span>
          </div>
          <div className="max-w-lg">
            <h1 className="text-3xl font-bold leading-tight text-cream">
              Tu taller, mostrando mates personalizados en minutos.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-stone-400">{VALUE_PROP}</p>
          </div>
          <p className="text-[11px] text-stone-600">
            Proyecto según <span className="font-mono text-stone-500">simulador_Mates/</span> — MVP
            paquete de 9 specs.
          </p>
        </div>
      </section>

      {/* Formulario */}
      <section className="flex w-full items-center justify-center bg-background px-6 lg:w-[520px] lg:border-l lg:border-line">
        <div className="w-full max-w-sm py-12">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gold/30 bg-white/5 font-bold text-gold-soft">
              M
            </div>
            <span className="text-xs font-bold uppercase tracking-[.2em] text-gold-soft">MOCAP 3D</span>
          </div>

          {banner && (
            <div
              role="status"
              className="mb-6 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs leading-relaxed text-gold-soft"
            >
              {banner}
            </div>
          )}

          <div className="mb-6 flex items-start gap-2 rounded-xl border border-gold/25 bg-white/[.03] p-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft" />
            <p className="text-xs leading-relaxed text-stone-300">{VALUE_PROP}</p>
          </div>

          <h2 className="text-xl font-bold text-cream">{copy.heading}</h2>
          <p className="mt-1 text-xs text-stone-500">Son dos campos. Nada más.</p>

          <div className="mt-5">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleGoogle}
              disabled={googleBusy || busy}
            >
              {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <span className="font-bold leading-none" aria-hidden>G</span>
              )}
              Continuar con Google
            </Button>
          </div>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-stone-600">
            <span className="h-px flex-1 bg-white/10" />
            o con tu email
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="tu@taller.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={!!error && !email.includes('@')}
            />
            {mode !== 'recover' && (
              <div>
                <Input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'signup' ? 'Contraseña (mínimo 8)' : 'Contraseña'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={!!passwordError}
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-[11px] text-stone-500 transition hover:text-gold-soft"
                    onClick={() => setMode('recover')}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
            {notice && !error && (
              <p className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-soft">
                {notice}
              </p>
            )}

            <Button type="submit" variant="secondary" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {copy.submit}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-stone-500">
            {mode === 'signup' ? '¿Ya tenés cuenta?' : '¿Primera vez por acá?'}{' '}
            <button
              type="button"
              className="font-semibold text-gold-soft hover:underline"
              onClick={() => {
                resetMessages();
                setMode(mode === 'signup' ? 'signin' : 'signup');
              }}
            >
              {mode === 'signup' ? 'Iniciá sesión' : 'Registrate gratis'}
            </button>
          </p>

          <p className="mt-8 text-center text-[10px] leading-relaxed text-stone-700">
            El Plan FREE no requiere tarjeta. El Plan PRO se contrata dentro del editor y exige
            aceptar los Términos y la Política de Privacidad vigentes.
          </p>

          {/* Posición 12 (R13.2): los dos botones legales son visibles también
              antes de crear la cuenta, sin login. */}
          <LegalFooter variant="prominent" className="mt-6 -mx-6 border-x-0 border-b-0 px-0" />
        </div>
      </section>
    </main>
  );
}
