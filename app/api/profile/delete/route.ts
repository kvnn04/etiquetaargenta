import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  createSupabaseServiceClient,
  hasServiceCredentials,
  removeStoragePrefix,
} from '@/lib/supabase/service';
import { accountStorageTargets } from '@/lib/profile/account-storage';

/**
 * POST /api/profile/delete — R8 del spec registro (Zona de peligro).
 * Flujo sin mailer (decisión 04-nov, el mailer de pagos no cubre esta ruta):
 *   1. users.deleted_at = now()  → bloquea el login con mensaje neutro.
 *   2. Links del dueño: borrado HARD inmediato con service-role (R1: las
 *      versiones son inmutables, pero la cuenta se va); link_approvals cae por
 *      el ON DELETE CASCADE de 0004.
 *   3. Proyectos del dueño: borrado HARD inmediato (RLS own_projects permite
 *      delete). El cascade project → links de 0004 es la segunda red.
 *   4. Assets de Storage: link-assets/{linkId}, designs/{userId} y
 *      branding/{userId} se limpian con best-effort; si Storage falla, la
 *      cuenta YA quedó inhabilitada y el huérfano se logea para soporte.
 *   5. signOut: la sesión muere ahí mismo.
 * Restauración: soporte re-runde ops/0920 (deleted_at = null) solo si el
 * pedido llega del MISMO email verificado dentro de 30 días. La purga final
 * (auth.users → cascada + Storage residual) también vive en ese ops file.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }

  /* 1) Bloqueo inmediato del login (la cuenta ya no puede volver a entrar). */
  const { error: softDeleteError } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', user.id);
  if (softDeleteError) {
    console.error('[profile/delete] users:', softDeleteError.message);
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 });
  }

  /* 2) Links + assets con service-role. Si falta la credencial, el borrado de
   *    proyectos igual arrastra los links por FK; Storage queda para soporte. */
  let linkIds: string[] = [];
  const serviceAvailable = hasServiceCredentials();
  if (serviceAvailable) {
    try {
      const service = createSupabaseServiceClient();
      const links = await service
        .from('links')
        .select('link_id')
        .eq('user_id', user.id);
      if (links.error) {
        console.error('[profile/delete] links select:', links.error.message);
      } else {
        linkIds = (links.data ?? []).map((row) => row.link_id);
      }

      const { error: linksError } = await service.from('links').delete().eq('user_id', user.id);
      if (linksError) {
        console.error('[profile/delete] links:', linksError.message);
      }
    } catch (err) {
      console.error('[profile/delete] service:', err instanceof Error ? err.message : err);
    }
  } else {
    console.error(
      '[profile/delete] service-role ausente: links y assets de Storage quedan para soporte',
    );
  }

  /* 3) Proyectos (RLS del dueño). El residual se revisa en soporte. */
  const { error: projectsError } = await supabase
    .from('projects')
    .delete()
    .eq('user_id', user.id);
  if (projectsError) {
    console.error('[profile/delete] projects:', projectsError.message);
  }

  /* 4) Storage: best-effort DESPUÉS de la DB (nunca deja links resolubles
   *    apuntando a assets ya borrados). */
  if (serviceAvailable) {
    await Promise.allSettled(
      accountStorageTargets(user.id, linkIds).map((target) =>
        removeStoragePrefix(target.bucket, target.prefix),
      ),
    );
  }

  /* 5) La sesión muere en el servidor. */
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    console.error('[profile/delete] signOut:', signOutError.message);
  }

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() });
}
