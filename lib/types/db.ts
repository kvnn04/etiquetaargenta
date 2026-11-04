/**
 * Tipos mínimos de filas (posición 1).
 * La generación completa con supabase gen-types llega con las posiciones
 * que crean las tablas restantes — acá evitamos dependencia anticipada.
 */
import type { Plan } from '@/lib/permissions';

/** Fila de public.users (migración 0001). El plan es la fuente gating R2. */
export interface UserRecord {
  id: string;
  base_name: string | null;
  plan: Plan | string | null;
  grace_expires_at: string | null;
}

/** Fila de public.pricing_config (una fila: pro_monthly_ars, spec_pagos R3). */
export interface PricingConfigRow {
  key: string;
  amount: number;
  currency: string;
  updated_at: string;
}
