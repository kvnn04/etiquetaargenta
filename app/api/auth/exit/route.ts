import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/auth/exit?motivo=inhabilitada — cerrar sesión server-side y volver
 * al overlay. Lo usan las páginas server cuando la fila del usuario está con
 * deleted_at activo (R8: "bloquea el login con mensaje neutro").
 */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const motivo =
    request.nextUrl.searchParams.get('motivo') === 'cuenta-eliminada' ? 'eliminada' : 'inhabilitada';
  return NextResponse.redirect(new URL(`/auth?cuenta=${motivo}`, request.url));
}

export const dynamic = 'force-dynamic';
