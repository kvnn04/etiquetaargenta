import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // El QA de integración vive en tests/qa y toca Supabase/MP TEST: se corre
    // SOLO con `npm run test:qa` (vitest.qa.config.ts) y QA_ALLOW_MUTATIONS=1.
    exclude: ['tests/qa/**'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(root),
    },
  },
});
