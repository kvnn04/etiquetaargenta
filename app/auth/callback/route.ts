import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Callback OAuth / verificación de email (PKCE):
 * intercambia ?code= por sesión y cae al editor.
 * Con error ⇒ vuelve al overlay con aviso genérico (sin detalles técnicos).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/editor`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=oauth`);
}
