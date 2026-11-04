import { NextResponse } from 'next/server';
import { createSupabaseServiceClient, hasServiceCredentials } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config/pricing
 * Precio del plan leído SIEMPRE del backend (pricing_config, spec_pagos R3):
 * la UI lo imprime tal cual, sin hardcodear montos.
 */
export async function GET() {
  if (!hasServiceCredentials()) {
    return NextResponse.json(
      { error: 'BACKEND_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from('pricing_config')
      .select('key, amount, currency, updated_at')
      .eq('key', 'pro_monthly_ars')
      .maybeSingle();

    if (error) {
      console.error('pricing_config read error:', error.message);
      return NextResponse.json({ error: 'PRICING_READ_FAILED' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'PRECIO_NO_CONFIGURADO' }, { status: 404 });
    }

    return NextResponse.json({
      key: data.key,
      amount: Number(data.amount),
      currency: data.currency ?? 'ARS',
      updatedAt: data.updated_at,
    });
  } catch (err) {
    console.error('pricing route error:', err);
    return NextResponse.json({ error: 'PRICING_READ_FAILED' }, { status: 500 });
  }
}
