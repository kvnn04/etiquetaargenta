import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Esqueleto de sesión (posición 1 del orden de implementación):
 * 1. Env vars ausentes ⇒ página amable /setup (nada de 500 pelados).
 * 2. Refresh del token a cada request (QA: reabrir en <30 días no pide re-login).
 * 3. Visitante en ruta protegida ⇒ redirect inmediato al Auth Overlay (spec_auth §7.1).
 * 4. Con sesión, /auth ya no tiene sentido ⇒ /editor.
 */
const REQUIRED_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

export function missingEnv(): string[] {
  return REQUIRED_KEYS.filter((key) => !process.env[key]);
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const missing = missingEnv();
  if (missing.length > 0) {
    if (request.nextUrl.pathname === '/setup') {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() (no getSession()): valida la firma del token contra el server de Supabase.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  /* Pos 10A (R8, spec shareable-link §6): /v/[linkId] es PÚBLICA de manera
   * DELIBERADA — abrir/ver/aprobar un enlace no paga ni loguea. JAMÁS agregar
   * /v a la lista que redirect a /auth: rompería el Modo Cliente completo. */
  if (!user && (path.startsWith('/editor') || path.startsWith('/perfil'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && path.startsWith('/auth') && !path.startsWith('/auth/callback')) {
    const url = request.nextUrl.clone();
    url.pathname = '/editor';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
