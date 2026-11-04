/* ============================================================================
 * MATRIZ R2 — ÚNICA FUENTE: spec_autenticacion_y_modelo_freemium.md §3-R2
 * ----------------------------------------------------------------------------
 * El README §5 declara que esta tabla canónica se define en esta spec y las
 * demás la CITAN (nunca la duplican). Este módulo es su implementación.
 *
 * Regla de seguridad (§6): el cliente SOLO decora (candado 🔒 visual);
 * toda acción pay-gated debe revalidarse server-side (limpiar localStorage no
 * concede nada). El claim del JWT es cache no autoritativa.
 * ============================================================================ */

/** Estados de cuenta (R1 de la spec de autenticación). */
export type Plan = 'free' | 'pro' | 'pro_grace';

/** Visitante sin sesión ⇒ plan null. */
export type PlanOrNull = Plan | null;

/**
 * Capacidades del editor que son FREE (columna FREE ✔ de la matriz R2).
 * Todo el editor es el gancho de valor de la demo.
 */
export type FreeCapability =
  | 'editor.model' // selector de producto del catálogo (pro:false): Camionero ⇄ Imperial
  | 'editor.colors' // colores #HEX de cuerpo y virola
  | 'editor.dimensions' // medidas milimétricas + guías + auto-giro
  | 'editor.design' // escala / rotación / espejo del grabado
  | 'design.slot' // cargar/reemplazar el diseño en el slot 1/1
  | 'project.save' // guardar proyecto (projects.state)
  | 'ficha.view'; // ver la grilla del modal de Ficha

/** Capacidades PRO (columna PRO de la matriz R2; en FREE muestran 🔒). */
export type ProOnlyCapability =
  | 'export.hd' // Foto HD / Ficha PNG / PDF (ticket server-side)
  | 'links.generate' // generar/regenerar enlaces comerciales
  | 'render.no-watermark' // renders sin marca de agua
  | 'brand.output.white-label' // logo del taller en outputs vendibles
  | 'product.pro.catalog'; // productos del catálogo con pro:true

export type Capability = FreeCapability | ProOnlyCapability;

/** Etiquetas legibles (UI) — el label es decoración, el permiso es `gate`. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  'editor.model': 'Producto del catálogo (pro:false)',
  'editor.colors': 'Colores de cuerpo y virola',
  'editor.dimensions': 'Medidas, guías y auto-giro',
  'editor.design': 'Escala, rotación y espejo del diseño',
  'design.slot': 'Cargar / reemplazar el diseño (slot 1/1)',
  'project.save': 'Guardar proyecto',
  'ficha.view': 'Ver la grilla de Ficha Técnica',
  'export.hd': 'Foto HD / Ficha PNG / PDF',
  'links.generate': 'Enlaces comerciales',
  'render.no-watermark': 'Renders sin marca de agua',
  'brand.output.white-label': 'Logo del taller en outputs',
  'product.pro.catalog': 'Productos PRO del catálogo',
};

export const FREE_CAPABILITIES: readonly FreeCapability[] = [
  'editor.model',
  'editor.colors',
  'editor.dimensions',
  'editor.design',
  'design.slot',
  'project.save',
  'ficha.view',
];

export const PRO_ONLY_CAPABILITIES: readonly ProOnlyCapability[] = [
  'export.hd',
  'links.generate',
  'render.no-watermark',
  'brand.output.white-label',
  'product.pro.catalog',
];

const FREE_SET: ReadonlySet<string> = new Set(FREE_CAPABILITIES);
const PRO_ONLY_SET: ReadonlySet<string> = new Set(PRO_ONLY_CAPABILITIES);

/**
 * gate(capability, plan) ⇒ ¿puede?
 *
 * - `pro`          → todo (matriz completa).
 * - `pro_grace`    → conserva el acceso PRO durante los 5 días de gracia
 *                    (R7: el downgrade llega al vencer la ventana, con banner).
 * - `free`         → solo edición (columna FREE ✔).
 * - `null` (visitante) → nada: redirect al Auth Overlay (QA §7.1).
 */
export function gate(capability: Capability, plan: PlanOrNull): boolean {
  if (plan === 'pro' || plan === 'pro_grace') return true;
  if (plan === 'free') return FREE_SET.has(capability);
  return false;
}

/** Helper de UI: ¿esta capacidad muestra candado 🔒 para este plan? */
export function isLockedFor(capability: Capability, plan: PlanOrNull): boolean {
  return !gate(capability, plan) && PRO_ONLY_SET.has(capability);
}
