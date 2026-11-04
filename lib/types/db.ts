/**
 * Tipos mínimos de filas (posiciones 1–2).
 * La generación completa con supabase gen-types llega con las posiciones
 * que crean las tablas restantes — acá evitamos dependencia anticipada.
 */
import type { Plan } from '@/lib/permissions';

/**
 * Fila de public.users. El plan es la fuente de gating (matriz R2);
 * los campos de branding son la materia prima de `lib/branding.ts` (R3).
 */
export interface UserRecord {
  id: string;
  base_name: string | null;
  plan: Plan | string | null;
  grace_expires_at: string | null;
  brand_name: string | null;
  logo_url: string | null;
  logo_thumb_url: string | null;
  whatsapp_e164: string | null;
  instagram_handle: string | null;
  location: string | null;
  deleted_at: string | null;
}

/** Fila de public.pricing_config (una fila: pro_monthly_ars, spec_pagos R3). */
export interface PricingConfigRow {
  key: string;
  amount: number;
  currency: string;
  updated_at: string;
}
