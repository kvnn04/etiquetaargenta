import fs from 'node:fs';
import path from 'node:path';

/**
 * Carga `.env` ANTES de importar los módulos de la app. Next lo hace solo;
 * Vitest no. Sin esto, createSupabaseServiceClient() y MP leen undefined.
 */
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] != null && process.env[key] !== '') continue;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] = value;
  }
}

if (process.env.QA_ALLOW_MUTATIONS !== '1') {
  throw new Error(
    'QA de integración bloqueado: definí QA_ALLOW_MUTATIONS=1 (escribe en Supabase TEST y crea/cancela preapprovals en MP TEST).',
  );
}
