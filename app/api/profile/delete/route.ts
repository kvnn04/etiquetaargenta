import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * POST /api/profile/delete — R8 del spec registro (Zona de peligro).
 * Flujo sin mailer (decisión 04-nov, mailler llega en 8–10):
 *   1. users.deleted_at = now()  → bloquea el login con mensaje neutro.
 *   2. Proyectos del dueño: borrado HARD inmediato (RLS own_projects permite
 *      delete). Los links/assets llegarán con las posiciones 8–10 (TODO).
 *   3. signOut: la sesión muere ahí mismo.
 * Restauración: soporte re-runde ops/0920 (deleted_at = null) solo si el
 * pedido llega del MISMO email verificado dentro de 30 días. La purga final
 * (auth.users ⇒ cascada) también vive en ese ops file / pg_cron.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  const { error: softDeleteError } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', user.id);
  if (softDeleteError) {
    console.error('[profile/delete] users:', softDeleteError.message);
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 });
  }

  const { error: projectsError } = await supabase
    .from('projects')
    .delete()
    .eq('user_id', user.id);
  if (projectsError) {
    // La cuenta ya queda bloqueada por deleted_at; el residual se revisa en soporte.
    console.error('[profile/delete] projects:', projectsError.message);
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error('[profile/delete] signOut:', signOutError.message);
  }

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() });
}
