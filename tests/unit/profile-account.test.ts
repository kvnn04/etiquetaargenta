/* ============================================================================
 * R8 del spec de registro — objetivos de Storage al eliminar cuenta.
 * La función es PURA: pinea los paths contra los que escriben `/api/links`
 * (link-assets/{linkId}, designs/{userId}) y `/api/profile/logo`
 * (branding/{userId}) sin tocar Supabase.
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import { accountStorageTargets } from '@/lib/profile/account-storage';

const USER = '11111111-2222-3333-4444-555555555555';

describe('accountStorageTargets (borrado en cascada R8)', () => {
  it('cubre link-assets por link + designs y branding por usuario', () => {
    expect(accountStorageTargets(USER, ['qo6khn', 'abc123'])).toEqual([
      { bucket: 'link-assets', prefix: 'qo6khn' },
      { bucket: 'link-assets', prefix: 'abc123' },
      { bucket: 'designs', prefix: USER },
      { bucket: 'branding', prefix: USER },
    ]);
  });

  it('deduplica linkIds y descarta vacíos', () => {
    expect(accountStorageTargets(USER, ['abc123', 'abc123', ''])).toEqual([
      { bucket: 'link-assets', prefix: 'abc123' },
      { bucket: 'designs', prefix: USER },
      { bucket: 'branding', prefix: USER },
    ]);
  });

  it('sin links igual limpia los assets por usuario', () => {
    expect(accountStorageTargets(USER, [])).toEqual([
      { bucket: 'designs', prefix: USER },
      { bucket: 'branding', prefix: USER },
    ]);
  });
});
