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
 * R2 — Orden canónico de composite: ESCALA → ESPEJO → ROTACIÓN (pos 7 conecta
 *      las dos primeras: spec_escala_y_alerta_de_desborde.md R2). La rotación
 *      actúa SIEMPRE última (resp. al mismo pivote central) y gira exactamente
 *      la imagen que el usuario ve en pantalla. Cambiar el orden queda
 *      prohibido en el motor (QA2 pos 7).
 * R3 — Representación angular canónica ÚNICA: escalar en [0°, 360°) con paso
 *      0.5°; normalización por módulo (370° ⇒ 10°, −90° ⇒ 270°, 45.25° ⇒ 45.5°
 *      con redondeo al medio grado más cercano). Jamás −180°/180° bipolar en
 *      UI, ficha ni payload. 360.0° exacto se representa como 0°.
 * R4 — Imán configurable: atracción ±4° cerca de los presets (solo en el
 *      arrastre del slider); los 4 presets fijan su ángulo EXACTO sin importar
 *      el estado del imán. El estado del imán es SOLO DE DISPOSITIVO (§5:
 *      localStorage — nunca en projects.state/jsonb).
 * R7 — Persistencia: `design.rotation` viaja en `projects.state` (se vuelve
 *      por variante A/B/C con la pos 10). Nota de ficha: "Rotación: 45° /
 *      45.5°" — un decimal SOLO si no es entero (convenio único de
 *      spec_detalle_del_modelo_en_ficha.md). La ESCALA (percent 70–110 paso
 *      0.5) y el ESPEJO (bool) también persisten con pos 7 (spec
 *      spec_escala_y_alerta_de_desborde.md R8) y los payloads comerciales los
 *      publican como `variants[n].scale`/`mirror`.
 * R8 — Re-muestreo: vivo en canvas de trabajo 2048×2048 (el SVG se rasteriza
 *      a esa resolución final); la exportación HD/Ficha (pos 9) re-proyecta a
 *      2048². El enlace comercial re-encoda a ≤1024² (R3 de links). Proyecto/
 *      link antiguo sin rotation ⇒ 0°.
 * ============================================================================ */

import { normalizeScale } from './overflow';

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
/* AJUSTE AL CARRIL (pos 6 provisional ⇒ pos 7 R1: 100 % = anclaje congelado)  */
/* -------------------------------------------------------------------------- */

/* La regla provisional de pos 6 (inscribir el diseño en el círculo del carril,
 * `inscribedFitSizePx`) fue SUSTITUIDA por el anclaje real de
 * spec_escala_y_alerta_de_desborde.md R1: el ráster contain-fit 2048² DE pos 6
 * ya dimensiona el trazado para que su envolvente toque el anillo de la chapa
 * — ese tamaño queda congelado y el 70–110 % multiplica SOBRE esa base (ver
 * lib/overflow.ts). Si se inscribía en el círculo W/√2 centrado en el EJE, la
 * máscara anular lo borraba por completo (el diseño quedaba dentro del hueco
 * R_int) — el reporte real "el SVG no se ve en la virola" nació acá. */

/* -------------------------------------------------------------------------- */
/* §5 — ESTADO frontend persistido                                            */
/* -------------------------------------------------------------------------- */

/** `projects.state.design` (pos 6 + pos 7): rotación, escala y espejo del
 *  grabado. La imagen del archivo es de SESIÓN (carga por el tallerista) y NO
 *  va al jsonb todavía — el ciclo de vida del archivo llega con las variantes
 *  (pos 7 slots A/B/C) y los links comerciales (pos 10). */
export interface DesignState {
  /** R3 pos 6: rotación en [0°, 360°) paso 0.5°. */
  rotation: number;
  /** R8 pos 7: escala en % [70, 110] paso 0.5% — multiplicador del fit fijo. */
  scale: number;
  /** R2 pos 7 (de spec_rotacion): espejo horizontal sobre el eje vertical central. */
  mirror: boolean;
}

/** R8: proyecto/link antiguo sin rotation/scale/mirror ⇒ 0° / 100% / OFF. */
export const DEFAULT_DESIGN_STATE: DesignState = { rotation: 0, scale: 100, mirror: false };

/** Normalizador tolerante del jsonb: falta el key ⇒ default; valor basura ⇒ default. */
export function normalizeDesignState(raw: unknown): DesignState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_DESIGN_STATE };
  }
  const o = raw as { rotation?: unknown; scale?: unknown; mirror?: unknown };
  const rotation = normalizeRotation(o.rotation);
  // R8 pos 7: scale/mirror viajan DESDE pos 7 — proyectos pos-6 (solo rotation)
  // cargan con 100 % / espejo OFF (los defaults contractuales).
  const scale = normalizeScale(o.scale);
  const mirror = o.mirror === true;
  return { rotation, scale, mirror };
}

/**
 * Recurso de diseño de SESIÓN (pos 6 + pos 7): raster del archivo ya en el
 * canvas de trabajo 2048² (R8) + metadatos para la UI y el motor de desborde.
 * SOLO vive en memoria del navegador: NO se persiste (el ciclo de vida del
 * archivo por variantes llega con pos 7 A/B/C y con los links pos 10).
 */
export interface DesignAsset {
  /** Raster de trabajo: contain-fit centrado en 2048², listo para componer. */
  canvas: HTMLCanvasElement;
  /** Nombre original del archivo (solo UI, nunca se envía al backend). */
  name: string;
  /** Formato declarado por el archivo (R8 habla de SVG/PNG). */
  kind: 'svg' | 'png';
  /**
   * R1 pos 7: base CONGELADA al cargar (mm) — el lado en mm del dibujo al
   * 100 % (en la carga: el D_ext vigente, con la envolvente tocando el anillo
   * por el contain-fit R8). Editar D_ext/D_int DESPUÉS no re-escala el diseño.
   */
  baseSideMm: number;
}

/**
 * Referencia SERVER-SIDE a un diseño persistido en el bucket privado
 * `designs` (pos 10A: el original del grabado se conserva por proyecto).
 * El server la entrega SOLO al dueño del proyecto, con URL firmada de vida
 * corta; el cliente la descarga y reconstruye el `DesignAsset` de sesión.
 */
export interface DesignSourceRef {
  /** URL firmada (bucket privado) — no se persiste ni se comparte. */
  url: string;
  name: string;
  kind: 'svg' | 'png';
  /** Base congelada al cargar el diseño (mm). */
  baseSideMm: number;
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
