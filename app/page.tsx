import { redirect } from 'next/navigation';

/**
 * Raíz: siempre al editor (la sesión la resuelve el middleware —
 * visitante ⇒ /auth; con sesión ⇒ /editor).
 */
export default function RootPage() {
  redirect('/editor');
}
