import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import EditorShell, { type ShellProfile } from '@/components/editor/editor-shell';
import type { Plan } from '@/lib/permissions';
import type { UserRecord } from '@/lib/types/db';

export const dynamic = 'force-dynamic';

/**
 * Editor (posiciones 3–7 traen la escena 3D acá).
 * El plan se resuelve SIEMPRE server-side (users.plan; el claim del JWT es
 * cache no autoritativa — spec_auth §3 Comportamiento del Sistema).
 */
export default async function EditorPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data, error } = await supabase
    .from('users')
    .select('id, base_name, plan, grace_expires_at')
    .eq('id', user.id)
    .maybeSingle<UserRecord>();

  if (error) {
    // Nunca tragar el motivo: lo muestra la consola del dev server
    // (un 'permission denied' debe verse, no confundirse con fila faltante).
    console.error(
      `[editor] public.users read error for user ${user.id}:`,
      error.message,
    );
  }

  const rawPlan = data?.plan;
  const plan: Plan =
    rawPlan === 'pro' || rawPlan === 'pro_grace' ? rawPlan : 'free';

  const profile: ShellProfile = {
    exists: Boolean(data),
    baseName: data?.base_name || 'MI TALLER',
    plan,
    graceExpiresAt: data?.grace_expires_at ?? null,
  };

  return <EditorShell userId={user.id} profile={profile} />;
}
