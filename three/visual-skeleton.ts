/* ============================================================================
 * ESQUELETO VISUAL — constantes plica de la posición 3
 * ----------------------------------------------------------------------------
 * Ninguno de estos números es un contrato de negocio: son valores visuales
 * mínimos con los que la escena 3D existe ANTES de que su spec de origen
 * los defina. Al llegar las posiciones 4 y 5, CADA constante se re-fija
 * citando su spec (regla: los números inmutables viven en su spec, §9 de
 * PROYECTO.md) — este archivo solo evita parámetros mágicos por el código.
 *
 * Único valor CON spec ya hoy: los diámetros por defecto 123.0 / 95.0 mm
 * (spec_tecnica_geometrica §2 Happy Path: "proyecto nuevo arranca con
 * Dext=123.0, Dint=95.0") y sus rangos R1 [70..180] / [50..150], paso 0.5.
 * ============================================================================ */

/** Diámetro exterior de la virola por defecto (spec geométrica §2). */
export const DEFAULT_EXT_DIAMETER_MM = 123.0;
/** Diámetro de la boca por defecto (spec geométrica §2). */
export const DEFAULT_INT_DIAMETER_MM = 95.0;

/** Altura de la banda metálica (virola) — PENDIENTE definirse en pos 4. */
export const VIROLA_BAND_HEIGHT_MM = 24;
/** Cuánto desciende el borde inferior de la banda por DEBAJO de la costura. */
export const VIROLA_COVER_BELOW_SEAM_MM = 3;
/** Grosor visual de la pared del cuerpo (labio de la boca) — pendiente pos 5. */
export const BODY_WALL_MM = 3;
/** Drop de la pared interior bajo el labio (apertura de la boca) — pos 5. */
export const RIM_INNER_DROP_MM = 8;

/**
 * CONTRATO DE COSTURA UV (único y compartido, three/README): phiStart tal
 * que el punto UV 0° caiga en la costura de la lathe. La rotación del
 * diseño (pos 6) y las guías (pos 4) se anclan a este valor.
 */
export const LATHE_SEAM_PHI_START = Math.PI;

/** Segmentos de la lathe: compromiso calidad/perf del MVP. */
export const LATHE_SEGMENTS = 96;
