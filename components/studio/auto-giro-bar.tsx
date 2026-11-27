'use client';

/* ============================================================================
 * AUTO-GIRO (barra flotante de la pestaña Estudio 3D) — spec_tecnica_geometrica §4
 * ----------------------------------------------------------------------------
 * R7: botón alternante de giro — activo (girando) ⇒ "Pausar" con fondo
 * discreto; inactivo ⇒ "Girar 360°" con fondo de acento. La pausa por
 * interacción (pointer/drag/pinch/scroll) la dispara la escena (OrbitControls
 * 'start') y aquí queda reflejada: en el EDITOR la reanudación exige pulsar
 * el botón (control explícito — el auto-resume de 4 s es del Modo Cliente,
 * pos 10). Velocidad: 0.75 RPM (EDITOR_AUTO_SPIN_RPM, R7).
 * El estado es de dispositivo: NO se persiste en el proyecto (R6).
 * ----------------------------------------------------------------------------
 * La misma barra hospeda el atajo de CÁMARA "Ver grabado": inclina la vista a
 * la corona (donde vive el diseño) sin tocar producto, giro ni órbita. Es un
 * estado de dispositivo: volver a "Vista general" restaura el 3/4 del editor.
 * ============================================================================ */

import { Box, Pause, RotateCw, ScanEye } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AutoGiroBar({
  spinning,
  onToggle,
  engravingView = false,
  onToggleEngravingView,
}: {
  spinning: boolean;
  onToggle: () => void;
  engravingView?: boolean;
  onToggleEngravingView?: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-2">
      {/* El envoltorio no intercepta el puntero: la órbita sigue libre alrededor de los botones */}
      <Button
        variant={spinning ? 'outline' : 'primary'}
        size="sm"
        className="pointer-events-auto bg-panel/80 backdrop-blur"
        onClick={onToggle}
        aria-pressed={spinning}
      >
        {spinning ? <Pause className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        {spinning ? 'Pausar' : 'Girar 360°'}
      </Button>
      {onToggleEngravingView && (
        <Button
          variant={engravingView ? 'primary' : 'outline'}
          size="sm"
          className="pointer-events-auto bg-panel/80 backdrop-blur"
          onClick={onToggleEngravingView}
          aria-pressed={engravingView}
          title="Encuadra el grabado para leerlo de frente"
        >
          {engravingView ? (
            <Box className="h-3.5 w-3.5" />
          ) : (
            <ScanEye className="h-3.5 w-3.5" />
          )}
          {engravingView ? 'Vista general' : 'Ver grabado'}
        </Button>
      )}
    </div>
  );
}
