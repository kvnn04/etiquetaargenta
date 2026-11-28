/* ============================================================================
 * MOTOR GRÁFICO DE LA FICHA — ÚNICA FUENTE: spec_detalle_del_modelo_en_ficha.md
 * ----------------------------------------------------------------------------
 * R6 — El ÚNICO motor es `makeQuoteCanvas`: PNG a escala 2× con lado mínimo
 *      2160 px (ancho fijo 1080 CSS × 2), alto ajustado AUTOMÁTICAMENTE al
 *      contenido (9 tarjetas + observaciones + pie del taller) sin superponer
 *      datos con el contacto de WhatsApp/Instagram. Archivo ≤ 5 MB (el render
 *      embebido pasa por un JPEG intermedio controlado: comprime la única
 *      zona fotorrealista y deja el resto como arte plano, el PNG más liviano).
 * R2 — Encabezado: marca del taller + vista previa HD del render (con las
 *      REGLAS DE ILUMINACIÓN DE LA ESCENA, SIN guías); grilla de 3 secciones
 *      (Producto / Grabado / Acabados) con las 9 tarjetas; tarjeta de Margen
 *      coloreada (verde / ámbar) según estado;
 * R4 — Degradación de marca heredada de `resolveBranding()` (pos 2, única
 *      implementación): sin logo ⇒ escudo con iniciales; sin nombre ⇒
 *      "MOCAP 3D · MATE PERSONALIZADO"; sin Instagram ⇒ columna/ícono
 *      removido; sin WhatsApp ⇒ pie sin CTA claro. La ausencia de datos
 *      opcionales jamás bloquea el export (degradación progresiva).
 * R5 — Observaciones: máximo 2 líneas con truncado elegante a `…` preservando
 *      palabras enteras (única vía: lib/quote/texts). Campo opcional: sin
 *      texto ⇒ el bloque NO se emite (sin bloques vacíos).
 * R7 — El canvas es la composición final SIN marca de agua (el sello del demo
 *      vive en la escena, no en la ficha); el artefacto se adjunta SOLO con
 *      ticket verificado server-side (R7 + contrato pos 8).
 * R8 — Sanidad: guías y overlays JAMÁS aparecen; el grabado se re-proyecta a
 *      ≥2048² (R8 de spec_rotacion) vía el compositor ÚNICO de
 *      lib/compose-engraving (la escena y la ficha comparten el mismo motor).
 * ----------------------------------------------------------------------------
 * Módulo CLIENT-ONLY: el modal lo carga con import() dinámico para que el
 * chunk del motor 3D (three ~600 kB) siga separado del HTML inicial (patrón
 * posición 3). Todo lo puro (textos/formatos/snapshot) vive en lib/quote.
 * ============================================================================ */

import * as THREE from 'three';
import {
  isMateThermoGeometry,
  isThermoProduct,
  resolveMateModel,
  resolveProduct,
  type ThermoProduct,
} from '@/lib/catalog';
import {
  adaptiveLaserBurn,
  resolveBodyPbr,
  resolveVirolaPbr,
  type BodyPresetId,
  type MetalPresetId,
} from '@/lib/color';
import { composeEngravingCanvas, composeEngravingHeightCanvas } from '@/lib/compose-engraving';
import {
  composeThermoEngravingCanvas,
  thermoAssetAspect,
  thermoCanvasHeight,
} from '@/lib/compose-thermo-engraving';
import {
  clampThermoRotation,
  normalizeThermoConfig,
  thermoBodyPbr,
  thermoLaserBurn,
  thermoSurface,
} from '@/lib/thermo';
import {
  buildBodyGeometry,
  buildVirolaTopGeometry,
  buildVirolaOuterWallGeometry,
  buildVirolaInnerWallGeometry,
} from '@/three/lathe-builder';
import {
  buildThermoBaseDiscGeometry,
  buildThermoBaseGeometry,
  buildThermoBodyGeometry,
  buildThermoCollarGeometry,
  buildThermoEngravingGeometry,
  buildThermoGrooveGeometry,
  buildThermoHandleGeometry,
  buildThermoInnerGeometry,
  buildThermoLidGeometry,
  buildThermoRimGeometry,
  buildThermoSeamGeometry,
  buildThermoSportCapDetailsGeometry,
  buildThermoSportCarabinerGeometry,
  buildThermoSportHandleGeometry,
  buildThermoSportRingGeometry,
  buildThermoSportSpoutGeometry,
  thermoHandleLinks,
  thermoHandleMounts,
} from '@/three/thermo-builder';
import {
  VIROLA_SKIRT_HEIGHT_MM,
  VIROLA_INNER_DROP_MM,
  VIROLA_COVER_BELOW_SEAM_MM,
} from '@/three/visual-skeleton';
import {
  CAMERA_FOV_DEG,
  TOP_VIEW_FIT_MARGIN,
  TOP_VIEW_OFFSET_MM,
  fitCameraDistanceMm,
  productFramingMm,
  thermoFramingMm,
} from '@/three/framing';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { woodGrainTexture } from '@/three/wood-grain';
import { createEngravingMaterial, ENGRAVING_LIFT_MM } from '@/three/engraving-material';
import { wrapObservations } from '@/lib/quote/texts';
import type { FichaSnapshot } from '@/lib/quote/snapshot';

/** FOV de la escena (mismo lente; la ficha usa vista cenital, no la 3/4 del editor). */
const FIELD_OF_VIEW_DEG = CAMERA_FOV_DEG;
/** R8 de spec_rotacion: la re-proyección HD del grabado es ≥2048². */
const ENGRAVING_HD_PX = 2048;

const FONT_STACK = "system-ui, 'Segoe UI', -apple-system, sans-serif";
const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT_STACK}`;

/* -------------------------------------------------------------------------- */
/* Paleta clara premium (decisión del titular: ficha compartida/imprimible)    */
/* -------------------------------------------------------------------------- */

const P = {
  bg: '#F8F2E6',
  card: '#FFFFFF',
  cardBorder: 'rgba(176, 132, 54, 0.24)',
  ink: '#221A10',
  muted: '#6E6355',
  hairline: 'rgba(34, 26, 16, 0.14)',
  gold: '#B08636',
  goldSoft: '#D9B25F',
  safeBg: '#E9F4EC',
  safeInk: '#1B7A3E',
  safeBorder: 'rgba(27, 122, 62, 0.38)',
  riskBg: '#FBF1DE',
  riskInk: '#A95C0A',
  riskBorder: 'rgba(169, 92, 10, 0.35)',
  chipGreen: '#1D9A55',
};

/* -------------------------------------------------------------------------- */
/* R2 — vista previa HD del render (escalena re-proyectada, sin guías)        */
/* -------------------------------------------------------------------------- */

export interface MateViewInput {
  mateModel: string;
  extDiameterMm: number;
  intDiameterMm: number;
  bodyPreset: string;
  metalPreset: string;
  bodyColor: string | null;
  virolaColor: string | null;
  /** pipeline canónico del grabado (pos 6–7) */
  rotationDeg: number;
  mirror: boolean;
  scalePct: number;
  /** ráster de trabajo del diseño (asset de sesión 1024²) o null ⇒ corona lisa */
  designAsset: HTMLCanvasElement | null;
  /** Termo: estado propio del producto (los mates lo ignoran). */
  thermo?: { offsetYPct: number; invert: boolean; finish: string } | null;
  /** tamaño CSS del encuadre; el framebuffer es CSS × dpr (2× por defecto) */
  widthCss: number;
  heightCss: number;
  dpr?: number;
}

/**
 * Render offscreen del MATE: mismo material PBR, las mismas 4 luces (reglas de
 * iluminación de la escena pos 3–5), mismo fondo y misma geometría de torno —
 * pero SIN guías, SIN pulso de desborde y SIN watermark (R6/R7: guías y
 * watermark jamás salen en outputs). La cámara es CENITAL (≈15° de inclinación
 * sobre la corona) para que el grabado de la virola se lea; la vista 3/4 del
 * editor dejaba el anillo de canto. Grabado re-proyectado a 2048² (R8).
 * Devuelve un canvas 2D y LIBERA el contexto WebGL (la ficha puede repetirse
 * varias veces sin agotar los contextos del navegador).
 */
export function renderMateView(input: MateViewInput): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;

  const catalogProduct = resolveProduct(input.mateModel);
  if (isThermoProduct(catalogProduct)) {
    return renderThermoView(input, catalogProduct);
  }

  const product = resolveMateModel(input.mateModel);
  const intDiameter = input.intDiameterMm;
  const extDiameter = input.extDiameterMm;
  const totalHeightMm = product.shape.totalHeightMm;
  const sealOverlapMm = product.shape.sealOverlapMm;
  const topY = totalHeightMm + sealOverlapMm;
  const skirtBottomY = totalHeightMm - VIROLA_SKIRT_HEIGHT_MM + VIROLA_COVER_BELOW_SEAM_MM;
  const innerBottomY = topY - VIROLA_INNER_DROP_MM;

  const dpr = input.dpr ?? 2;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(input.widthCss, input.heightCss, true);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b0d');

  const camera = new THREE.PerspectiveCamera(
    FIELD_OF_VIEW_DEG,
    input.widthCss / input.heightCss,
    1,
    4000,
  );
  /* Ficha/Foto HD: vista desde ARRIBA (≈15° de inclinación) apuntando a la
   * corona, donde vive el grabado. La cámara 3/4 del editor/visor dejaba el
   * anillo de la virola de canto y el diseño no se leía.
   * El encuadre se calcula con el radio real del producto (no la esfera
   * completa): así la corona ocupa la ficha y no queda chica. */
  const { maxRadiusMm } = productFramingMm(product, intDiameter, extDiameter);
  const target = new THREE.Vector3(0, topY, 0);
  const dir = new THREE.Vector3(...TOP_VIEW_OFFSET_MM).normalize();
  const dist = fitCameraDistanceMm(
    maxRadiusMm,
    input.widthCss / input.heightCss,
    FIELD_OF_VIEW_DEG,
    TOP_VIEW_FIT_MARGIN,
  );
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);

  /* Luces: los 4 focos EXACTOS de la escena — la ficha muestra lo que el
   * tallerista vio (sanidad compartida con la escena pos 3–5). */
  scene.add(new THREE.HemisphereLight('#fff4e0', '#14100c', 0.55));
  const key = new THREE.DirectionalLight('#ffe9c4', 1.15);
  key.position.set(200, 260, 220);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#9fb4d8', 0.5);
  fill.position.set(-220, 90, -160);
  scene.add(fill);
  const warm = new THREE.PointLight('#ffd9a0', 250, 600);
  warm.position.set(0, 40, 170);
  scene.add(warm);

  /* IBL local (mismo RoomEnvironment que la escena): el metal PBR necesita
   * un entorno para reflejar; sin él la virola sale negra en la ficha. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.85;
  room.dispose();
  pmrem.dispose();

  const group = new THREE.Group();
  scene.add(group);

  const disposables: Array<{ dispose(): void }> = [];

  // Cuerpo (lathe del catálogo, material PBR pos 5)
  const bodyGeo = buildBodyGeometry(product, intDiameter);
  const bodyPbr = resolveBodyPbr(input.bodyPreset as BodyPresetId, input.bodyColor);
  const grain = woodGrainTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(bodyPbr.color),
    roughness: bodyPbr.roughness,
    metalness: bodyPbr.metalness,
    map: grain ?? undefined,
    bumpMap: grain ?? undefined,
    bumpScale: 0.25,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));
  disposables.push(bodyGeo, bodyMat);

  // Virola 3 mallas (corona + faldón + pared interior) — material único (R2 pos 5)
  const virolaPbr = resolveVirolaPbr(input.metalPreset as MetalPresetId, input.virolaColor);
  const virolaMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(virolaPbr.color),
    metalness: virolaPbr.metalness,
    roughness: virolaPbr.roughness,
    side: THREE.DoubleSide,
  });
  const geoTop = buildVirolaTopGeometry(intDiameter, extDiameter);
  const geoOuter = buildVirolaOuterWallGeometry(extDiameter, topY, skirtBottomY);
  const geoInner = buildVirolaInnerWallGeometry(intDiameter, topY, innerBottomY);
  const topMesh = new THREE.Mesh(geoTop, virolaMat);
  topMesh.position.set(0, topY, 0);
  group.add(topMesh);
  group.add(new THREE.Mesh(geoOuter, virolaMat));
  group.add(new THREE.Mesh(geoInner, virolaMat));
  disposables.push(geoTop, geoOuter, geoInner, virolaMat);

  // Grabado HD (compositor ÚNICO a 2048² — re-proyección R8) sobre la corona,
  // con mapa de relieve derivado del mismo canvas (marca láser mate).
  if (input.designAsset) {
    const burn = adaptiveLaserBurn(input.virolaColor);
    const texCanvas = document.createElement('canvas');
    texCanvas.width = ENGRAVING_HD_PX;
    texCanvas.height = ENGRAVING_HD_PX;
    const heightCanvas = document.createElement('canvas');
    heightCanvas.width = ENGRAVING_HD_PX;
    heightCanvas.height = ENGRAVING_HD_PX;
    composeEngravingCanvas(
      texCanvas,
      input.designAsset,
      input.rotationDeg,
      input.mirror,
      input.scalePct,
      burn,
      intDiameter / 2,
      extDiameter / 2,
    );
    composeEngravingHeightCanvas(heightCanvas, texCanvas);
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const tex = new THREE.CanvasTexture(texCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    const heightTex = new THREE.CanvasTexture(heightCanvas);
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.anisotropy = maxAnisotropy;
    heightTex.needsUpdate = true;
    const engraveMat = createEngravingMaterial(tex, heightTex, burn.opacity);
    const engraveMesh = new THREE.Mesh(geoTop, engraveMat);
    engraveMesh.position.set(0, topY + ENGRAVING_LIFT_MM, 0);
    engraveMesh.renderOrder = 1; // virola 0 < grabado 1 (sin guías: nada en 2)
    group.add(engraveMesh);
    disposables.push(engraveMat, tex, heightTex);
  }

  // Suelo sutil (coherencia visual con la escena; NO gira)
  const floorGeo = new THREE.CircleGeometry(1200, 64);
  // Mismo color que el fondo (sin tonemapping): evita la línea de horizonte.
  const floorMat = new THREE.MeshBasicMaterial({ color: '#0b0b0d', toneMapped: false });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  disposables.push(floorGeo, floorMat);

  try {
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = Math.round(input.widthCss * dpr);
    out.height = Math.round(input.heightCss * dpr);
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(renderer.domElement, 0, 0, out.width, out.height);
    return out;
  } catch (err) {
    console.error('[ficha] render HD:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    for (const d of disposables) d.dispose();
    envTarget.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/* -------------------------------------------------------------------------- */
/* Render offscreen del TERMO (Ficha / Foto HD)                               */
/* -------------------------------------------------------------------------- */

/**
 * Mismo encuadre 3/4 que el editor, con el grabado lateral re-proyectado a
 * ≥2048 px de ancho. Sin guías, sin watermark: la ficha imprime exactamente lo
 * que el tallerista ve en el estudio.
 */
function renderThermoView(
  input: MateViewInput,
  product: ThermoProduct,
): HTMLCanvasElement | null {
  const spec = product.thermo;
  const config = normalizeThermoConfig(input.thermo ?? {});
  const aspect = thermoAssetAspect(input.designAsset);
  /* La ficha/Foto HD muestra SIEMPRE el grabado: se gira el producto para
   * llevar el centro del diseño al frente (+Z), con el ángulo ya clampado al
   * arco libre. Es el equivalente lateral de la vista cenital del mate. */
  const rotationDeg = clampThermoRotation(spec, input.rotationDeg, input.scalePct, aspect);
  const dpr = input.dpr ?? 2;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(input.widthCss, input.heightCss, true);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0b0d');

  const camera = new THREE.PerspectiveCamera(
    FIELD_OF_VIEW_DEG,
    input.widthCss / input.heightCss,
    1,
    4000,
  );
  const framing = thermoFramingMm(spec);
  const target = new THREE.Vector3(0, framing.centerYMm, 0);
  const dir = new THREE.Vector3(0, 40, 260).normalize();
  const dist = fitCameraDistanceMm(
    framing.sphereRadiusMm,
    input.widthCss / input.heightCss,
    FIELD_OF_VIEW_DEG,
    1.08,
  );
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.lookAt(target);

  scene.add(new THREE.HemisphereLight('#fff4e0', '#14100c', 0.55));
  const key = new THREE.DirectionalLight('#ffe9c4', 1.15);
  key.position.set(200, 260, 220);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#9fb4d8', 0.5);
  fill.position.set(-220, 90, -160);
  scene.add(fill);
  const warm = new THREE.PointLight('#ffd9a0', 250, 600);
  warm.position.set(0, 40, 170);
  scene.add(warm);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.85;
  room.dispose();
  pmrem.dispose();

  const group = new THREE.Group();
  group.rotation.y = (-rotationDeg * Math.PI) / 180;
  scene.add(group);
  const disposables: Array<{ dispose(): void }> = [];

  const isSystem = spec.geometry === 'system';
  const isSport = spec.geometry === 'sport';
  const isRecto = isMateThermoGeometry(spec.geometry);
  const isBottle = spec.geometry === 'bowling' || isSport;
  const pbr = thermoBodyPbr(config.finish, input.bodyColor, spec);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pbr.color),
    metalness: pbr.metalness,
    roughness: pbr.roughness,
  });
  group.add(new THREE.Mesh(buildThermoBodyGeometry(spec), bodyMat));
  disposables.push(bodyMat);

  const steelMat = new THREE.MeshStandardMaterial({
    color: '#E6EBF0',
    metalness: 0.92,
    roughness: 0.22,
    envMapIntensity: 0.9,
  });
  const steelDoubleMat = new THREE.MeshStandardMaterial({
    color: '#E6EBF0',
    metalness: 0.92,
    roughness: 0.22,
    envMapIntensity: 0.9,
    side: THREE.DoubleSide,
  });
  const collarMat = new THREE.MeshStandardMaterial({
    color: '#16181D',
    metalness: 0.15,
    roughness: 0.48,
  });
  const siliconeMat = new THREE.MeshStandardMaterial({
    color: '#111317',
    metalness: 0.05,
    roughness: 0.85,
  });
  const sportPlasticMat = new THREE.MeshStandardMaterial({
    color: '#151619',
    metalness: 0.08,
    roughness: 0.3,
    envMapIntensity: 0.95,
  });
  const spoutMat = new THREE.MeshStandardMaterial({
    color: '#E4E9EF',
    metalness: 0,
    roughness: 0.14,
    envMapIntensity: 1.3,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const carabinerMat = new THREE.MeshStandardMaterial({
    color: '#18181B',
    metalness: 0.65,
    roughness: 0.3,
    envMapIntensity: 1.1,
  });
  if (!isBottle && !isRecto) group.add(new THREE.Mesh(buildThermoBaseGeometry(spec), steelMat));
  if (!isRecto) {
    group.add(new THREE.Mesh(buildThermoLidGeometry(spec), isSport ? sportPlasticMat : steelMat));
  }
  if (isRecto) {
    group.add(new THREE.Mesh(buildThermoBaseDiscGeometry(spec), steelMat));
    group.add(new THREE.Mesh(buildThermoRimGeometry(spec), steelDoubleMat));
    group.add(new THREE.Mesh(buildThermoInnerGeometry(spec), steelDoubleMat));
  }
  disposables.push(
    steelMat,
    steelDoubleMat,
    collarMat,
    siliconeMat,
    sportPlasticMat,
    spoutMat,
    carabinerMat,
  );

  if (isSport) {
    group.add(new THREE.Mesh(buildThermoSportCapDetailsGeometry(spec), sportPlasticMat));
    group.add(new THREE.Mesh(buildThermoSportHandleGeometry(spec), sportPlasticMat));
    group.add(new THREE.Mesh(buildThermoSportSpoutGeometry(spec), spoutMat));
    group.add(new THREE.Mesh(buildThermoSportCarabinerGeometry(spec), carabinerMat));
    group.add(new THREE.Mesh(buildThermoSportRingGeometry(spec), steelMat));
  }

  if (isRecto) {
    // El Mate Recto no tiene collarín: el labio y el interior de acero ya se
    // agregaron arriba; el dorso queda libre para el grabado.
  } else if (isBottle) {
    // Aro de silicona (Bowling) o cuello de acero (Deportiva) bajo la tapa.
    group.add(
      new THREE.Mesh(buildThermoCollarGeometry(spec), isSport ? steelMat : siliconeMat),
    );
  } else if (!isSystem) {
    group.add(new THREE.Mesh(buildThermoCollarGeometry(spec), collarMat));
    const grooveGeo = buildThermoGrooveGeometry(spec);
    const grooveMat = new THREE.MeshStandardMaterial({ color: '#0B0C0E', roughness: 0.7 });
    disposables.push(grooveMat);
    for (const dy of [-1.26, 0, 1.26]) {
      const groove = new THREE.Mesh(grooveGeo, grooveMat);
      groove.position.set(0, spec.collarBottomMm + 7.56 + dy, 0);
      groove.rotation.set(Math.PI / 2, 0, -Math.PI * 0.72);
      group.add(groove);
    }
  } else {
    const seam = new THREE.Mesh(buildThermoSeamGeometry(spec), collarMat);
    seam.position.y = spec.lidBottomMm;
    seam.rotation.x = Math.PI / 2;
    group.add(seam);
  }

  if (!isBottle && !isRecto) {
    const handleGroup = new THREE.Group();
    handleGroup.rotation.y = spec.handleAngleRad;
    handleGroup.add(new THREE.Mesh(buildThermoHandleGeometry(spec), collarMat));

    if (!isSystem) {
      const knobGeo = new THREE.CylinderGeometry(0.11 * 36, 0.11 * 36, 0.24 * 36, 24);
      const knob = new THREE.Mesh(knobGeo, collarMat);
      knob.position.set(0, spec.collarBottomMm + 7.2, spec.radiusMm - 0.015 * 36);
      knob.rotation.x = Math.PI / 2;
      handleGroup.add(knob);
      disposables.push(knobGeo);
    } else {
      const mounts = thermoHandleMounts(spec);
      if (mounts.length > 0) {
        const mountGeo = new THREE.BoxGeometry(...mounts[0]!.sizeMm);
        disposables.push(mountGeo);
        for (const m of mounts) {
          const mount = new THREE.Mesh(mountGeo, collarMat);
          mount.position.set(0, m.yMm, m.zMm);
          handleGroup.add(mount);
        }
      }
      const up = new THREE.Vector3(0, 1, 0);
      for (const l of thermoHandleLinks(spec)) {
        const start = new THREE.Vector3(l.xMm, l.y1Mm, l.z1Mm);
        const end = new THREE.Vector3(l.xMm, l.y2Mm, l.z2Mm);
        const dir = end.clone().sub(start);
        const rodGeo = new THREE.CylinderGeometry(l.radiusMm, l.radiusMm, dir.length(), 16);
        const rod = new THREE.Mesh(rodGeo, steelMat);
        rod.position.copy(start).addScaledVector(dir, 0.5);
        rod.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        handleGroup.add(rod);
        disposables.push(rodGeo);
      }
    }
    group.add(handleGroup);
  }

  if (input.designAsset) {
    const burn = thermoLaserBurn(input.bodyColor, spec);
    const texCanvas = document.createElement('canvas');
    texCanvas.width = ENGRAVING_HD_PX;
    texCanvas.height = thermoCanvasHeight(spec, ENGRAVING_HD_PX);
    const heightCanvas = document.createElement('canvas');
    heightCanvas.width = texCanvas.width;
    heightCanvas.height = texCanvas.height;
    composeThermoEngravingCanvas(
      texCanvas,
      input.designAsset,
      {
        rotationDeg,
        scalePct: input.scalePct,
        mirror: input.mirror,
        offsetYPct: config.offsetYPct,
        invert: config.invert,
      },
      spec,
      burn,
    );
    composeEngravingHeightCanvas(heightCanvas, texCanvas);
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const tex = new THREE.CanvasTexture(texCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    const heightTex = new THREE.CanvasTexture(heightCanvas);
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.anisotropy = maxAnisotropy;
    heightTex.needsUpdate = true;
    const engraveMat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: heightTex,
      bumpScale: -0.018,
      transparent: true,
      opacity: burn.opacity,
      depthWrite: false,
      metalness: 0.72,
      roughness: 0.34,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const surface = thermoSurface(spec);
    const engraveMesh = new THREE.Mesh(buildThermoEngravingGeometry(spec), engraveMat);
    engraveMesh.position.set(0, surface.centerYMm, 0);
    engraveMesh.renderOrder = 1;
    group.add(engraveMesh);
    disposables.push(engraveMat, tex, heightTex);
  }

  const floorGeo = new THREE.CircleGeometry(1200, 64);
  const floorMat = new THREE.MeshBasicMaterial({ color: '#0b0b0d', toneMapped: false });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  disposables.push(floorGeo, floorMat);

  try {
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = Math.round(input.widthCss * dpr);
    out.height = Math.round(input.heightCss * dpr);
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(renderer.domElement, 0, 0, out.width, out.height);
    return out;
  } catch (err) {
    console.error('[ficha] render termo HD:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    for (const d of disposables) d.dispose();
    envTarget.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/* -------------------------------------------------------------------------- */
/* Utilidades de dibujo                                                       */
/* -------------------------------------------------------------------------- */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Envuelve texto por palabras con medición real del ctx (cortes por ancho). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Fecha legible de la ficha (es-AR). */
export function formatFichaDate(epochMs: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

/** Carga el logo por fetch CORS→blob (canvas-safe) o null ⇒ escudo (R4). */
async function loadBrandImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('logo ilegible'));
      img.src = URL.createObjectURL(blob);
    });
  } catch {
    return null; // R4: sin logo ⇒ escudo de iniciales (jamás bloquea el export)
  }
}

/* -------------------------------------------------------------------------- */
/* R6 — makeQuoteCanvas: el único motor gráfico de la Ficha                    */
/* -------------------------------------------------------------------------- */

/** Escala del motor: 2× ⇒ lado mínimo 2160 px con ancho CSS fijo de 1080. */
export const QUOTE_SCALE = 2;
export const QUOTE_CSS_WIDTH = 1080;
export const QUOTE_MIN_SIDE_PX = 2160;

export interface QuoteCanvasInput {
  /** Snapshot congelado (R1): TODO el contenido impreso sale de acá. */
  snapshot: FichaSnapshot;
  /** Vista HD previa (renderMateView); null ⇒ placa oscura con iniciales. */
  renderCanvas: HTMLCanvasElement | null;
  /**
   * Calidad del JPEG intermedio del render embebido (control de peso R6: el
   * PNG final debe quedar ≤ 5 MB). El caller puede re-generar con menos
   * calidad si el blob excede la cota.
   */
  jpegQuality?: number;
}

export async function makeQuoteCanvas(input: QuoteCanvasInput): Promise<HTMLCanvasElement> {
  const s = input.snapshot;
  const S = QUOTE_SCALE;
  const W = QUOTE_CSS_WIDTH;
  const PAD = 56;

  /* ---- Pasada 1: medición pura (el alto se ajusta al contenido, R6) ---- */
  const scratch = document.createElement('canvas');
  scratch.width = 10;
  scratch.height = 10;
  const m = scratch.getContext('2d')!;

  const RW = 430;
  const RH = 470;

  const gridW = W - PAD * 2;
  const gap = 14;
  const prodCardW = (gridW - gap * 3) / 4; // Producto: 4 tarjetas (R2)
  const grabCardW = (gridW - gap * 2) / 3; // Grabado: 3 tarjetas
  const acaCardW = (gridW - gap) / 2; // Acabados: 2 tarjetas

  const CARD_TITLE = 11;
  const CARD_VALUE = 20;
  const CARD_LINE = 26;
  const CARD_PAD = 16;
  const TITLE_GAP = 9;

  const fmtMm = (v: number | null): string | null =>
    typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} mm` : null;

  const valueLines = (value: string | null, width: number, maxLines: number): number => {
    m.font = font(CARD_VALUE, 600);
    const text = value ?? '—';
    return Math.max(1, Math.min(wrapText(m, text, width - CARD_PAD * 2).length || 1, maxLines));
  };
  const rowValueLines = (vs: (string | null)[], cw: number, maxLines: number): number =>
    Math.max(...vs.map((v) => valueLines(v, cw, maxLines)));

  const isThermo = s.family === 'thermo' && s.thermo !== null;
  const prodValues: Array<string | null> = isThermo
    ? [s.thermo!.capacidadEtiqueta, s.thermo!.altoEtiqueta, s.thermo!.diametroEtiqueta]
    : [fmtMm(s.extDiameterMm), fmtMm(s.intDiameterMm), fmtMm(s.bandaMm)];
  const prodCH =
    CARD_PAD * 2 + CARD_TITLE + TITLE_GAP + CARD_LINE * rowValueLines(prodValues, prodCardW, 2);

  const gEmpty = s.grabadoSinDiseno;
  const grabValues: Array<string | null> = [
    gEmpty ? 'Sin diseño cargado' : s.escalaEtiqueta,
    gEmpty
      ? 'Sin diseño cargado'
      : isThermo
        ? (s.thermo?.posicionEtiqueta ?? '—')
        : s.rotacionEtiqueta,
    gEmpty ? 'Sin diseño cargado' : (s.margenEtiqueta ?? '—'),
  ];
  const grabCH =
    CARD_PAD * 2 + CARD_TITLE + TITLE_GAP + CARD_LINE * rowValueLines(grabValues, grabCardW, 3);

  const acaValues: Array<string | null> = [s.virolaEtiqueta, s.cuerpoEtiqueta];
  const acaCH =
    CARD_PAD * 2 + CARD_TITLE + TITLE_GAP + CARD_LINE * rowValueLines(acaValues, acaCardW, 2);

  const LINE_ROW = 26;

  // Observaciones (R5): hasta 2 líneas truncadas o NADA (sin bloque vacío).
  const obsText = s.observaciones.trim();
  const obsCardW = gridW - 2 * CARD_PAD - 30 - 6;
  let obsH = 0;
  let obsLines: string[] = [];
  if (obsText.length > 0) {
    m.font = font(18, 400);
    obsLines = wrapObservations(obsText, obsCardW, (t) => m.measureText(t).width, 2);
    obsH = CARD_PAD * 2 + CARD_TITLE + TITLE_GAP + obsLines.length * LINE_ROW;
  }

  // Pie (R4): hairline + fila del taller (IG en línea) + linkId opcional +
  // CTA opcional + firma fina — la reserva cubre el bloque completo.
  const linkLine = s.linkId ? 22 : 0;
  const footH = 26 + 22 + 22 + linkLine + 40;

  const headerH = RH + 26;
  const SECT = 22; // aire entre secciones
  const sectionsH = 34 + prodCH + SECT + 34 + grabCH + SECT + 34 + acaCH;
  const H = Math.max(
    QUOTE_CSS_WIDTH, // el alto nunca baja del lado mínimo (2160 device)
    PAD + headerH + 6 + sectionsH + (obsLines.length > 0 ? obsH + SECT : 0) + footH + PAD,
  );

  /* ---- Pasada 2: dibujo final ---- */
  const canvas = document.createElement('canvas');
  canvas.width = W * S; // 2160 px — lado mínimo (R6)
  canvas.height = Math.round(H * S);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas no disponible');
  ctx.scale(S, S);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  /* ── Encabezado: marca (R4) + vista HD del render (sin guías) ── */
  let y = PAD;

  // Placa del render a la derecha (sombra + marco)
  const rx = W - PAD - RW;
  const ry = y;
  ctx.save();
  ctx.shadowColor = 'rgba(60, 40, 10, 0.18)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, rx, ry, RW, RH, 26);
  ctx.fillStyle = '#12100C';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, rx + 4, ry + 4, RW - 8, RH - 8, 22);
  ctx.clip();
  if (input.renderCanvas) {
    const qual = input.jpegQuality ?? 0.92;
    const emb = document.createElement('canvas');
    emb.width = input.renderCanvas.width;
    emb.height = input.renderCanvas.height;
    const ectx = emb.getContext('2d');
    if (ectx) {
      ectx.drawImage(input.renderCanvas, 0, 0);
      const jpeg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = emb.toDataURL('image/jpeg', qual);
      });
      if (jpeg) {
        const fit = Math.max((RW - 8) / emb.width, (RH - 8) / emb.height);
        const dw = emb.width * fit;
        const dh = emb.height * fit;
        ctx.drawImage(jpeg, rx + 4 + (RW - 8 - dw) / 2, ry + 4 + (RH - 8 - dh) / 2, dw, dh);
      }
    }
  }
  if (!input.renderCanvas) {
    // Fallback cubierto (render ausente): placa oscura con iniciales (R4)
    ctx.fillStyle = '#1A1712';
    ctx.fillRect(rx, ry, RW, RH);
    ctx.fillStyle = 'rgba(217, 178, 95, 0.14)';
    ctx.fillRect(rx, ry, RW, RH);
    ctx.fillStyle = P.goldSoft;
    ctx.font = font(84, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.brand.initials, rx + RW / 2, ry + RH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.strokeStyle = P.cardBorder;
  ctx.lineWidth = 1.2;
  roundRect(ctx, rx + 0.5, ry + 0.5, RW - 1, RH - 1, 26);
  ctx.stroke();

  // Columna de marca a la izquierda
  const colX = PAD + 78;
  const colW = rx - colX - 34;

  ctx.save();
  // Escudo del taller: logo PRO o iniciales (R4 — degradación canónica)
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = P.cardBorder;
  ctx.lineWidth = 1.4;
  roundRect(ctx, PAD, y, 62, 62, 16);
  ctx.fill();
  ctx.stroke();
  let pendingInitials = true;
  if (s.brand.logoThumbUrl) {
    const logo = await loadBrandImage(s.brand.logoThumbUrl);
    if (logo) {
      const fit = Math.max(54 / logo.naturalWidth, 54 / logo.naturalHeight);
      const dw = logo.naturalWidth * fit;
      const dh = logo.naturalHeight * fit;
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      roundRect(ctx, PAD + 3, y + 3, 56, 56, 13);
      ctx.clip();
      ctx.drawImage(logo, PAD + 3 + (56 - dw) / 2, y + 3 + (56 - dh) / 2, dw, dh);
      ctx.restore();
      pendingInitials = false;
    }
  }
  if (pendingInitials) {
    ctx.fillStyle = P.gold;
    ctx.font = font(24, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.brand.initials, PAD + 31, y + 32);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Título (hasta 2 líneas) + caption + fecha
  ctx.font = font(24, 800);
  ctx.fillStyle = P.ink;
  const titleLines = wrapText(ctx, s.brand.title, colW).slice(0, 2);
  let ty = y + 20;
  for (const line of titleLines) {
    ctx.fillText(line, colX, ty);
    ty += 30;
  }
  ctx.font = font(12, 700);
  ctx.fillStyle = P.gold;
  ctx.fillText('F I C H A   T É C N I C A   D E   P R O D U C T O', colX, ty + 10);
  ctx.font = font(13, 400);
  ctx.fillStyle = P.muted;
  ctx.fillText(`Generada el ${formatFichaDate(s.capturedAt)}`, colX, ty + 32);
  ctx.restore();

  y += headerH;

  /* ── Grilla: 3 secciones con las 9 tarjetas (R2) ── */
  type CardState = 'plain' | 'safe' | 'risk';
  const sectionCard = (
    cx: number,
    cy: number,
    cw: number,
    ch: number,
    title: string,
    value: string | null,
    state: CardState,
    caption?: string | null,
  ): void => {
    ctx.save();
    if (state === 'safe') {
      ctx.fillStyle = P.safeBg;
      ctx.strokeStyle = P.safeBorder;
      ctx.lineWidth = 1.6;
    } else if (state === 'risk') {
      ctx.fillStyle = P.riskBg;
      ctx.strokeStyle = P.riskBorder;
      ctx.lineWidth = 1.6;
    } else {
      ctx.fillStyle = P.card;
      ctx.strokeStyle = P.cardBorder;
      ctx.lineWidth = 1.2;
    }
    roundRect(ctx, cx, cy, cw, ch, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.muted;
    ctx.font = font(CARD_TITLE, 700);
    ctx.fillText(title.toUpperCase(), cx + CARD_PAD, cy + CARD_PAD + CARD_TITLE * 0.85);

    ctx.fillStyle = state === 'risk' ? P.riskInk : state === 'safe' ? P.safeInk : P.ink;
    ctx.font = font(CARD_VALUE, 600);
    const text = value ?? '—';
    const lines = wrapText(ctx, text, cw - CARD_PAD * 2).slice(0, title === 'Margen' ? 3 : 2);
    let ly = cy + CARD_PAD + CARD_TITLE + TITLE_GAP + CARD_LINE * 0.8;
    for (const line of lines) {
      ctx.fillText(line, cx + CARD_PAD, ly);
      ly += CARD_LINE;
    }
    if (caption) {
      ctx.font = font(11, 600);
      ctx.fillText(caption, cx + CARD_PAD, ly - CARD_LINE + 6);
    }
    ctx.restore();
  };

  const sectionTitle = (label: string, baseline: number): void => {
    ctx.fillStyle = P.gold;
    ctx.font = font(15, 800);
    ctx.fillText(label.toUpperCase(), PAD, baseline);
    const textW = ctx.measureText(label.toUpperCase()).width;
    ctx.strokeStyle = P.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD + textW + 24, baseline + 1);
    ctx.lineTo(W - PAD, baseline + 1);
    ctx.stroke();
  };

  // 1) PRODUCTO (4 tarjetas)
  let cursor = y + 14;
  sectionTitle('Producto', cursor);
  const py = cursor + 14;
  cursor = py + prodCH;
  let cx = PAD;
  const prodCards: Array<[string, string | null]> = isThermo
    ? [
        ['Modelo', s.modeloEtiqueta],
        [s.thermo!.capacidadTitulo, prodValues[0] ?? null],
        ['Altura Total', prodValues[1] ?? null],
        ['Diámetro del Cuerpo', prodValues[2] ?? null],
      ]
    : [
        ['Modelo', s.modeloEtiqueta],
        ['Diámetro Exterior', prodValues[0] ?? null],
        ['Diámetro Interior', prodValues[1] ?? null],
        ['Ancho de Banda', prodValues[2] ?? null],
      ];
  for (const [t, v] of prodCards) {
    sectionCard(cx, py, prodCardW, prodCH, t, v, 'plain');
    cx += prodCardW + gap;
  }

  // 2) GRABADO (3 tarjetas; "Sin diseño cargado" cuando no hay archivo)
  cursor += SECT;
  sectionTitle('Grabado', cursor + 12);
  const gy = cursor + 26;
  cursor = gy + grabCH;
  cx = PAD;
  const margenState: CardState = gEmpty
    ? 'plain'
    : s.margenEstado === 'safe'
      ? 'safe'
      : s.margenEstado === 'overflow'
        ? 'risk'
        : 'plain';
  const grabCards: Array<[string, string | null, CardState]> = [
    ['Escala', gEmpty ? 'Sin diseño cargado' : s.escalaEtiqueta, 'plain'],
    [
      isThermo ? 'Posición' : 'Rotación',
      gEmpty ? 'Sin diseño cargado' : isThermo ? (s.thermo?.posicionEtiqueta ?? '—') : s.rotacionEtiqueta,
      'plain',
    ],
    ['Margen', gEmpty ? 'Sin diseño cargado' : s.margenEtiqueta, margenState],
  ];
  for (const [t, v, st] of grabCards) {
    sectionCard(
      cx,
      gy,
      grabCardW,
      grabCH,
      t,
      v,
      st,
      t === 'Margen' && s.margenAproximado ? 'Detección aproximada' : null,
    );
    cx += grabCardW + gap;
  }

  // 3) ACABADOS (2 tarjetas — descriptores fijos R3)
  cursor += SECT;
  sectionTitle('Acabados', cursor + 12);
  const ay = cursor + 26;
  cursor = ay + acaCH;
  cx = PAD;
  const acaCards: Array<[string, string | null]> = isThermo
    ? [
        ['Acabado', s.thermo?.acabadoEtiqueta ?? null],
        ['Color / Cuerpo', s.cuerpoEtiqueta],
      ]
    : [
        ['Virola', s.virolaEtiqueta],
        ['Color / Cuerpo', s.cuerpoEtiqueta],
      ];
  for (const [t, v] of acaCards) {
    sectionCard(cx, ay, acaCardW, acaCH, t, v, 'plain');
    cx += acaCardW + gap;
  }
  y = cursor;

  /* ── Observaciones (R5: bloque opcional, máx 2 líneas con `…`) ── */
  if (obsLines.length > 0) {
    y += SECT;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = P.cardBorder;
    ctx.lineWidth = 1.2;
    roundRect(ctx, PAD, y, gridW, obsH, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.goldSoft;
    roundRect(ctx, PAD + 10, y + 14, 4, obsH - 28, 2);
    ctx.fill();

    ctx.fillStyle = P.muted;
    ctx.font = font(CARD_TITLE, 700);
    ctx.fillText('OBSERVACIONES', PAD + 30, y + CARD_PAD + CARD_TITLE * 0.85);
    ctx.fillStyle = P.ink;
    ctx.font = font(18, 400);
    let ly = y + CARD_PAD + CARD_TITLE + TITLE_GAP + LINE_ROW * 0.8;
    for (const line of obsLines) {
      ctx.fillText(line, PAD + 30, ly);
      ly += LINE_ROW;
    }
    ctx.restore();
    y += obsH;
  }

  /* ── Pie del taller (R4: sin nombre ⇒ fallback; sin IG ⇒ removido; sin WA ⇒ sin CTA) ── */
  y += 26;
  ctx.strokeStyle = P.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 22;

  ctx.fillStyle = P.ink;
  ctx.font = font(15, 700);
  ctx.fillText(s.brand.title, PAD, y);
  const titleW = ctx.measureText(s.brand.title).width;
  if (s.brand.instagramHandle) {
    ctx.fillStyle = P.muted;
    ctx.font = font(12, 600);
    ctx.fillText(`· @${s.brand.instagramHandle}`, PAD + titleW + 12, y + 0.5);
  }
  if (s.linkId) {
    ctx.fillStyle = P.muted;
    ctx.font = font(11, 600);
    ctx.fillText(`Enlace comercial ${s.linkId}`, PAD, y + 22);
  }

  // CTA del pie: SOLO con WhatsApp válido (R4: sin WA ⇒ pie sin CTA claro)
  if (s.brand.whatsappE164) {
    const label = `WhatsApp ${s.brand.whatsappE164}`;
    ctx.font = font(13, 700);
    const tw = ctx.measureText(label).width;
    const pillW = tw + 44;
    const pillH = 30;
    const px = W - PAD - pillW;
    const ppy = y - 10;
    ctx.save();
    ctx.fillStyle = P.chipGreen;
    roundRect(ctx, px, ppy, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, px + 26, ppy + pillH / 2 + 4.5);
    ctx.beginPath();
    ctx.arc(px + 15, ppy + pillH / 2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.chipGreen;
    ctx.font = font(9, 900);
    ctx.textAlign = 'center';
    ctx.fillText('W', px + 15, ppy + pillH / 2 + 3.5);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // Firma fina (fecha + plataforma — nunca tapa el contacto, R6)
  ctx.fillStyle = 'rgba(34, 26, 16, 0.55)';
  ctx.font = font(10, 400);
  ctx.textAlign = 'center';
  ctx.fillText(`Ficha generada con MOCAP 3D · ${formatFichaDate(s.capturedAt)}`, W / 2, H - 20);
  ctx.textAlign = 'left';

  return canvas;
}

/** PNG del canvas final — el caller verifica la cota ≤ 5 MB (R6). */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
