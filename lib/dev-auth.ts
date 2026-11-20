/* ============================================================================
 * BYPASS DE AUTENTICACIÓN — SOLO DESARROLLO LOCAL
 * ----------------------------------------------------------------------------
 * Con `DEV_AUTH_BYPASS=1` en el `.env`:
 *   · /editor abre sin sesión (perfil de desarrollo, plan PRO de prueba).
 *   · /auth y /perfil redirigen al editor (login/registro inaccesibles).
 *   · El autosave guarda SOLO en localStorage (no toca Supabase).
 *
 * Para reactivar login y registro: borrar/comentar la variable y reiniciar
 * `npm run dev`. NUNCA setear esta variable en producción.
 * ============================================================================ */

export function isAuthBypassEnabled(): boolean {
  return process.env.DEV_AUTH_BYPASS === '1';
}
