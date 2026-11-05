/* ============================================================================
 * DISEÑO DEL GRABADO — ÚNICA FUENTE: spec_rotacion_archivo_svg_png.md
 * ----------------------------------------------------------------------------
 * R1 — Marco canónico: 0° = eje donde nace la costura UV de la chapa plana,
 *      pivote en el CENTRO del carril (origen 50%/50% del canvas circular). Un
 *      solo marco vale para TODOS los productos del catálogo. La escena
 *      materializa el ancla con LATHE_SEAM_PHI_START (contrato de three/README);
 *      en el canvas polar de la corona superior el Frente (+Z) es el borde
 *      superior, así los presets aterrizan exactamente como los nombra la spec R4:
 *      0° Frente · 90° Der · 180° Dorso · 270° Izq (nota visual anotada: la
 *      costura de la lathe queda al dorso — ver engranador en studio-scene).
 * R2 — Orden canónico de composite: escala (pos 7) → espejo (pos 7) → ROTACIÓN.
 *      La rotación actúa SIEMPRE última (resp. al mismo pivote central) y gira
 *      exactamente la imagen que el usuario ve en pantalla. Cambiar el orden
 *      queda prohibido en el motor (QA2 pos 7).
 * R3 — Representación angular canónica ÚNICA: escalar en [0°, 360°) con paso
 *      0.5°; normalización por módulo (370° ⇒ 10°, −90° ⇒ 270°, 45.25° ⇒ 45.5°
 *      con redondeo al medio grado más cercano). Jamás −180°/180° bipolar en
 *      UI, ficha ni payload. 360.0° exacto se representa como 0°.
 * R4 — Imán configurable: atracción ±4° cerca de los presets (solo en el
 *      arrastre del slider); los 4 presets fijan su ángulo EXACTO sin importar
 *      el estado del imán. El estado del imán es SOLO DE DISPOSITIVO (§5:
 *      localStorage — nunca en projects.state/jsonb).
 * R7 — Persistencia: `design.rotation` viaja en `projects.state` (se vuelve
 *      por variante A/B/C con la pos 7). Nota de ficha: "Rotación: 45° / 45.5°"
 *      — un decimal SOLO si no es entero (convenio único de
 *      spec_detalle_del_modelo_en_ficha.md).
 * R8 — Re-muestreo: vivo en canvas de trabajo 1024×1024; la exportación
 *      HD/Ficha (pos 9) re-proyecta a ≥2048². Proyecto/link antiguo sin
 *      rotation ⇒ 0°.
 * ============================================================================ */

/** R3: paso canónico del ángulo (medio grado). */
export const ROTATION_STEP_DEG = 0.5;

/** R4: umbral de atracción del imán. */
export const MAGNET_THRESHOLD_DEG = 4;

/** R4: los 4 presets fijan el ángulo EXACTO sin importar el estado del imán. */
export interface RotationPreset {
  angle: number;
  label: string;
}

export const ROTATION_PRESETS: readonly RotationPreset[] = [
  { angle: 0, label: '0° Frente' },
  { angle: 90, label: '90° Der' },
  { angle: 180, label: '180° Dorso' },
  { angle: 270, label: '270° Izq' },
];

/* -------------------------------------------------------------------------- */
/* R3 — NORMALIZACIÓN ANGULAR                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza un ángulo a la representación canónica R3: escalar en [0°, 360°)
 * redondeado al medio grado más cercano. Cualquier entrada no numérica
 * (strings, null, NaN, ∞) ⇒ 0° — la escena jamás pierde la alineación.
 */
export function normalizeRotation(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  let v = raw % 360;
  if (v < 0) v += 360;
  const rounded = Math.round(v / ROTATION_STEP_DEG) * ROTATION_STEP_DEG;
  const wrapped = Math.round(rounded * 2) % 720; // evita 360 tras el redondeo
  return wrapped / 2;
}

/**
 * Parser del campo numérico (§6 validaciones): acepta dígitos, `.` y `,`
 * decimales, signo y sufijo °. Devuelve el número crudo (aún SIN normalizar)
 * o null si la entrada no es un ángulo interpretable.
 */
export function parseRotationInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/°/g, '').replace(',', '.');
  //  .5      45.5     -90.0   +15
  if (cleaned === '' || cleaned === '+' || cleaned === '-') return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

/* -------------------------------------------------------------------------- */
/* R4 — IMÁN                                                                  */
/* -------------------------------------------------------------------------- */

/** Distancia angular mínima en grados, consciente del envolvente 360. */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * R4: preset enganchado bajo el imán (±4°, wrap 360 ⇒ 0 incluido), o null.
 * Con el imán OFF SIEMPRE es null (arrastre 100 % continuo en pasos de 0.5°).
 */
export function magnetSnappedPreset(angle: number, magnetOn: boolean): number | null {
  if (!magnetOn) return null;
  for (const preset of ROTATION_PRESETS) {
    if (angularDistance(angle, preset.angle) <= MAGNET_THRESHOLD_DEG) return preset.angle;
  }
  return null;
}

/** R4: aplicar el imán a un ángulo (identidad con imán OFF o fuera del rango). */
export function applyMagnet(angle: number, magnetOn: boolean): number {
  const snap = magnetSnappedPreset(angle, magnetOn);
  return snap === null ? angle : snap;
}

/* -------------------------------------------------------------------------- */
/* R7 — FORMATO DE FICHA                                                      */
/* -------------------------------------------------------------------------- */

/**
 * R7: "Rotación: 45° / 45.5°" — un decimal SOLO si no es entero. Su consumo
 * llega con la Ficha (pos 9); vive acá como único convenio citando la spec.
 */
export function formatRotationLabel(angle: number): string {
  const norm = normalizeRotation(angle);
  return Number.isInteger(norm) ? `${norm}°` : `${norm.toFixed(1)}°`;
}

/* -------------------------------------------------------------------------- */
/* AJUSTE PROVISIONAL AL CARRIL (pos 6 — nota, NO contrato)                   */
/* -------------------------------------------------------------------------- */

/**
 * Tamaño lateral (px) para inscribir el diseño en el CÍRCULO inscrito del
 * carril (radio = W_banda / 2 sobre R_centro). Un cuadrado de lado S tiene
 * semidiagonal S·√2/2; exigir semidiagonal ≤ semiancho del carril garantiza
 * que NINGÚN ángulo saque el trazado fuera del anillo (QA1 sin desborde
 * espurio). La regla EXACTA de fit + banner "chorreo" llega con la pos 7
 * (spec_escala...): ahí este tope crece de 0.707·W a lo que la escala permita.
 */
export function inscribedFitSizePx(bandWidthMm: number, pxPerMm: number): number {
  if (!Number.isFinite(bandWidthMm) || !Number.isFinite(pxPerMm) || bandWidthMm <= 0 || pxPerMm <= 0) {
    return 0;
  }
  return (bandWidthMm / Math.SQRT2) * pxPerMm;
}

/* -------------------------------------------------------------------------- */
/* §5 — ESTADO frontend persistido                                            */
/* -------------------------------------------------------------------------- */

/** `projects.state.design` (pos 6): la rotación activa del grabado. La imagen
 *  del archivo es de SESIÓN (carga por el tallerista) y NO viaja al jsonb
 *  todavía — el ciclo de vida del archivo llega con variantes (pos 7) y links
 *  comerciales (pos 10). */
export interface DesignState {
  rotation: number;
}

/** R8: proyecto/link antiguo sin rotation ⇒ 0°. */
export const DEFAULT_DESIGN_STATE: DesignState = { rotation: 0 };

/** Normalizador tolerante del jsonb: falta el key ⇒ default; valor basura ⇒ 0. */
export function normalizeDesignState(raw: unknown): DesignState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_DESIGN_STATE };
  }
  const rotation = normalizeRotation((raw as { rotation?: unknown }).rotation);
  return { rotation };
}

/**
 * Recurso de diseño de SESIÓN (pos 6): raster del archivo ya en el canvas de
 * trabajo 1024² (R8) + metadatos para la UI. SOLO vive en memoria del
 * navegador: NO se persiste (el archivo viaja con variantes pos 7 / links pos 10).
 */
export interface DesignAsset {
  /** Raster de trabajo: contain-fit centrado en 1024², listo para componer. */
  canvas: HTMLCanvasElement;
  /** Nombre original del archivo (solo UI, nunca se envía al backend). */
  name: string;
  /** Formato declarado por el archivo (R8 habla de SVG/PNG). */
  kind: 'svg' | 'png';
}

/* -------------------------------------------------------------------------- */
/* §5 — imán SOLO DE DISPOSITIVO (localStorage; nunca projects.state)         */
/* -------------------------------------------------------------------------- */

export const SNAP_MAGNET_STORAGE_KEY = 'mocap:design-snap-magnet';

/** Parser puro del valor almacenado: falta ⇒ ON (R4 default); '0'/'false' ⇒ OFF. */
export function parseSnapMagnetStored(raw: string | null): boolean {
  if (raw === null) return true;
  return raw !== '0' && raw !== 'false';
}

/** Serializador puro (espejo del parser). */
export function snapMagnetToStorage(on: boolean): string {
  return on ? '1' : '0';
}

/** Lee el imán del dispositivo con fallback tolerante (siempre ON por defecto). */
export function loadSnapMagnetDefault(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return parseSnapMagnetStored(localStorage.getItem(SNAP_MAGNET_STORAGE_KEY));
  } catch {
    return true;
  }
}

/** Persiste el imán en el dispositivo (§5: NUNCA en el jsonb del proyecto). */
export function saveSnapMagnet(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SNAP_MAGNET_STORAGE_KEY, snapMagnetToStorage(on));
  } catch {
    /* modo privado / sin storage: la edición sigue */
  }
}
