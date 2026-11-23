import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * QA de INTEGRACIÓN (no corre en `npm test`): toca Supabase TEST y Mercado Pago
 * TEST. Muta la base TEST, crea/cancela preapprovals y hace checkout real; NO
 * llama al endpoint de refunds de MP (los pagos semilla son `live_mode: true`).
 * Se ejecuta a mano:
 *
 *   $env:QA_ALLOW_MUTATIONS='1'; npm.cmd run test:qa
 *
 * Requiere `.env` con credenciales TEST y que los 4 pagos semilla existan.
 */
export default defineConfig({
  test: {
    include: ['tests/qa/**/*.qa.test.ts'],
    environment: 'node',
    setupFiles: ['tests/qa/setup.ts'],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(root),
    },
  },
});
