'use client';

import { useState } from 'react';
import { AlertTriangle, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Doble confirmación para eliminar cuenta (R8).
 * Con el mailer de posición 8–10 se suma el "link por email"; hoy la confirmación
 * es en pantalla (palabra clave + botón final), decisión 04-nov.
 */
export default function DangerConfirm({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  if (!open) return null;

  const keywordOk = keyword.trim().toUpperCase() === 'ELIMINAR';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="danger-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-500/30 bg-panel shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 px-4 py-3">
          <TriangleAlert className="h-4 w-4 text-rose-300" />
          <h2 id="danger-title" className="text-xs font-bold tracking-wider text-rose-200">
            ELIMINAR CUENTA — irreversible
          </h2>
        </div>

        <div className="space-y-3 px-4 py-4">
          {!confirmed ? (
            <>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-stone-400">
                <li>· Se borran <b className="text-stone-300">inmediatamente</b> tus proyectos y diseños cargados.</li>
                <li>· Tu cuenta queda inhabilitada: nadie podrá entrar con este email.</li>
                <li>· Tus datos se purgan a los <b className="text-stone-300">30 días</b>. Hasta ahí el soporte puede restaurarla si vos lo pedís desde este mismo email.</li>
              </ul>
              <p className="text-[11px] text-stone-500">Escribí <span className="font-mono font-bold text-rose-300">ELIMINAR</span> para habilitar el botón:</p>
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="ELIMINAR"
                invalid={keyword.length > 0 && !keywordOk}
                autoFocus
              />
              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancelar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!keywordOk}
                  onClick={() => setConfirmed(true)}
                  className="border-rose-500/40 text-rose-300 hover:border-rose-400 hover:text-rose-200"
                >
                  Continuar
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-stone-300">
                Última confirmación: la eliminación <b>no se puede deshacer desde la app</b> y
                tus datos se purgan a los 30 días.
              </p>
              <div className="flex items-center justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Salir
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onConfirm}
                  disabled={busy}
                  className="border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
