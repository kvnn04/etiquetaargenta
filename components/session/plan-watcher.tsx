'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Desbloqueo realtime (R6 spec_auth): escucha UPDATE de la fila users
 * del usuario logueado y refresca el árbol server-side (router.refresh()).
 * Cuando el webhook de Mercado Pago cambie users.plan, todas las pestañas
 * abiertas se actualizan sin reload ni re-login.
 * Requiere replicación realtime de public.users (migra 0001 + dashboard).
 */
export default function PlanWatcher({ userId }: { userId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    const channel = supabase
      .channel('users-plan:' + userId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${userId}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, router]);

  return null;
}
