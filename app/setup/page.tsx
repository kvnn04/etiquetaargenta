import Link from 'next/link';

/**
 * Página amable cuando faltan variables de entorno: el middleware redirige acá
 * en vez de tirar un 500 pelado (mismo criterio que las "páginas amables" de links).
 */

function envStatus(key: string): boolean {
  return Boolean(process.env[key]);
}

const row = (ok: boolean, name: string) => (
  <tr key={name} className="border-b border-line/50">
    <td className="py-2 pr-3 font-mono text-xs text-stone-300">{name}</td>
    <td className={`py-2 text-xs font-semibold ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {ok ? 'configurada ✓' : 'falta'}
    </td>
  </tr>
);

export default function SetupPage() {
  const publicOk = envStatus('NEXT_PUBLIC_SUPABASE_URL') && envStatus('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceOk = envStatus('SUPABASE_SERVICE_ROLE_KEY');

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-[10px] uppercase tracking-[.24em] text-gold-soft">Configuración</p>
      <h1 className="mt-2 text-2xl font-bold text-cream">Faltan variables de entorno</h1>
      <p className="mt-2 text-sm text-stone-400">
        El esqueleto de Auth (posición 1) no arranca sin la conexión a Supabase.
        Copiá <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs">.env.local.example</code> a{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs">.env.local</code> y completá:
      </p>

      <table className="mt-6 w-full rounded-xl border border-line bg-panel p-4 text-left">
        <tbody className="px-4">
          {row(envStatus('NEXT_PUBLIC_SUPABASE_URL'), 'NEXT_PUBLIC_SUPABASE_URL')}
          {row(envStatus('NEXT_PUBLIC_SUPABASE_ANON_KEY'), 'NEXT_PUBLIC_SUPABASE_ANON_KEY')}
          {row(serviceOk, 'SUPABASE_SERVICE_ROLE_KEY (server-side)')}
        </tbody>
      </table>

      <ol className="mt-6 space-y-2 text-sm text-stone-300">
        <li className="rounded-lg bg-panel px-4 py-3">
          1. Crear proyecto Supabase (región recomendada: <span className="text-gold-soft">sa-east-1</span>).
        </li>
        <li className="rounded-lg bg-panel px-4 py-3">
          2. Cumplir la migración <code className="font-mono text-xs">supabase/migrations/0001_auth_skeleton.sql</code> en el SQL Editor.
        </li>
        <li className="rounded-lg bg-panel px-4 py-3">
          3. Reiniciar <code className="font-mono text-xs">npm run dev</code> y recargar.
        </li>
      </ol>

      <p className="mt-8 text-xs text-stone-500">
        Detalle completo de setup en el README del repo.{' '}
        {publicOk && (
          <>
            Vars públicas presentes —<Link href="/auth" className="mx-1 text-gold-soft underline">ir al Auth Overlay</Link>
            (la API de pricing requiere además la service role key).
          </>
        )}
      </p>
    </main>
  );
}
