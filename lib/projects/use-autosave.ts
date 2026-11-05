'use client';

/* ============================================================================
 * AUTOSAVE HOOK — spec_tipo_de_mate.md §5 (debounce 2 s, last-write-wins)
 * y §6 (corte de red: borrador local con timestamp, sincronización al
 * reconectar, reintento con backoff exponencial).
 * ----------------------------------------------------------------------------
 * El borrador localStorage es SIEMPRE una copia del último snapshot del
 * store (no hay merge: la app es mono-editor). Conserva qué contenido
 * todavía no confirmó el backend.
 * ============================================================================ */

import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft, saveProjectState } from './persistence';
import { useEditorStore, snapshotOf } from '@/lib/store/editor';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Backoff de reintento (§6): pasos exponenciales hasta 30 s. */
const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function useProjectPersistence(supabase: SupabaseClient): void {
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryStep = useRef(0);
  const lastSent = useRef<string>('');

  useEffect(() => {
    const store = useEditorStore;

    function scheduleRetry(): void {
      if (retryTimer.current) return; // ya hay un reintento esperando
      const delay = BACKOFF_STEPS_MS[Math.min(retryStep.current, BACKOFF_STEPS_MS.length - 1)]!;
      retryStep.current += 1;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void attemptSave(true);
      }, delay);
    }

    async function attemptSave(force: boolean): Promise<void> {
      const s = store.getState();
      if (!s.dirty && !s.offlineDraft && !force) return; // nada pendiente

      const snap = snapshotOf(s);
      const payload = JSON.stringify({ ...snap, id: s.projectId });
      if (!force && payload === lastSent.current) return;

      const res = await saveProjectState(supabase, s.projectId, snap);
      if (res.ok) {
        lastSent.current = payload;
        retryStep.current = 0;
        store.getState().markSaved(res.at, res.id);
        store.getState().markOfflineDraft(false);
        clearLocalDraft();
      } else {
        // Guarda el borrador y quedate en modo offline (§6).
        saveLocalDraft(snap);
        store.getState().markOfflineDraft(true);
        scheduleRetry();
      }
    }

    function scheduleFlush(): void {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void attemptSave(false), AUTOSAVE_DEBOUNCE_MS);
    }

    const unsub = store.subscribe((state) => {
      if (state.dirty || state.offlineDraft) scheduleFlush();
    });

    function onOnline(): void {
      if (loadLocalDraft()) void attemptSave(true);
    }
    window.addEventListener('online', onOnline);

    return (): void => {
      unsub();
      window.removeEventListener('online', onOnline);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [supabase]);
}
