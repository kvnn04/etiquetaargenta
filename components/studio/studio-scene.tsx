'use client';

/* ============================================================================
 * ESCENA 3D (posiciones 4–7) — spec_seleccion_de_color + spec_tecnica_geometrica
 * + spec_rotacion_archivo_svg_png + spec_escala_y_alerta_de_desborde (grabado)
 * ----------------------------------------------------------------------------
 * Sobre la base de la posición 3 (cuerpo lathe del catálogo + banda metálica):
 *  · La banda de virola ahora lee las D_ext/D_int VIGENTES del store (R8:
 *    reconstruye su geometría sin re-inicializar luces, sin resetear la
 *    órbita ni el estado del auto-giro).
 *  · GuidesLayer (R4/R5): capa vectorial sobre la malla del anillo, anclada al
 *    UV de la costura (phiStart compartido), con la tabla canónica de colores
 *    y doble trazo para legibilidad sobre cualquier acabado.
 *  · Auto-giro (R7): el GRUPO producto gira a 0.75 RPM — NO la cámara: la
 *    órbita del usuario jamás se rompe (QA4) y cualquier interacción sobre el
 *    lienzo (pointer/drag/pinch/scroll, vía OrbitControls 'start') pausa al
 *    instante; en el editor la reanudación exige el botón (R7).
 *  · La cascada R3 termina acá: un único setDiameters ⇒ cuerpo/banda/guías
 *    reconstruyen SOLO su geometría (memo por diámetros), luces intactas.
 *  · Grabado del diseño (pos 6–7): CanvasTexture 1024² sobre la corona superior
 *    con el pipeline canónico ESCALA → ESPEJO → ROTACIÓN de
 *    spec_rotacion_archivo_svg_png.md + spec_escala_y_alerta_de_desborde.md —
 *    ángulo/escala/espejo JAMÁS reconstruyen geometría ni re-inicializan
 *    luces: solo re-compositan el canvas (DesignEngravingLayer: marco R1/R4,
 *    máscara anular y quemado).
 *  · Desborde "chorreo" (pos 7, R5): el motor vive en lib/overflow + el chequeo
 *    se alimenta de la envolvente de tinta de sesión (store). Las guías de
 *    bordes AFECTADAS (círculo exterior/interior) pulsan en ROJO 500 ms [&] lo
 *    que dura el estado — overlay encima de esta capa de guías.
 * ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { resolveMateModel, resolveProduct, isThermoProduct, type ThermoProduct } from '@/lib/catalog';
import { useEditorStore } from '@/lib/store/editor';
import { adaptiveLaserBurn, resolveBodyPbr, resolveVirolaPbr } from '@/lib/color';
import {
  clampThermoRotation,
  normalizeThermoOffset,
  thermoDesignSizeMm,
  thermoSurface,
} from '@/lib/thermo';
import { thermoAssetAspect } from '@/lib/compose-thermo-engraving';
import ThermoProductView from '@/components/thermo/thermo-product';
import { EDITOR_AUTO_SPIN_RPM, rpmToRadPerSec } from '@/lib/virola';
import { evaluateOverflow } from '@/lib/overflow';
import { composeEngravingCanvas, composeEngravingHeightCanvas } from '@/lib/compose-engraving';
import {
  BORDES_DASH_MM,
  CENTRO_DASH_MM,
  GUIDE_AXIS_STROKE,
  GUIDE_BACK_STROKE,
  GUIDE_COLORS,
  GUIDE_FRONT_STROKE,
  GUIDE_SURFACE_OFFSET_MM,
  guideRadialAxisPoints,
  guideRadialAxisTicks,
  guideCirclePoints,
} from '@/three/guides';
import {
  VIROLA_SKIRT_HEIGHT_MM,
  VIROLA_INNER_DROP_MM,
  VIROLA_COVER_BELOW_SEAM_MM,
} from '@/three/visual-skeleton';
import {
  buildBodyGeometry,
  buildVirolaTopGeometry,
  buildVirolaOuterWallGeometry,
  buildVirolaInnerWallGeometry,
} from '@/three/lathe-builder';
import {
  CAMERA_FOV_DEG,
  CAMERA_OFFSET_MM,
  CAMERA_TARGET_Y_MM,
  ENGRAVING_VIEW_FIT_MARGIN,
  engravingViewPoseMm,
  fitCameraDistanceMm,
  productFramingMm,
  thermoFramingMm,
} from '@/three/framing';
import { StudioEnvironment } from '@/three/studio-environment';
import { woodGrainTexture } from '@/three/wood-grain';
import { createEngravingMaterial, ENGRAVING_LIFT_MM } from '@/three/engraving-material';

/** R5: patrones de punteado de los tres tipos de guía, tipados para drei Line. */
const DASH_BORDES = BORDES_DASH_MM as { dashSize: number; gapSize: number };
const DASH_CENTRO = CENTRO_DASH_MM as { dashSize: number; gapSize: number };

type GeometryCache = Map<string, THREE.BufferGeometry>;
const bodyCache: GeometryCache = new Map();
const virolaCache: GeometryCache = new Map();

function cached(key: string, make: () => THREE.BufferGeometry, cache: GeometryCache): THREE.BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const geo = make();
  cache.set(key, geo);
  return geo;
}

/* -------------------------------------------------------------------------- */
/* Cuerpo: mesh de lathe del catálogo (swap instantáneo R3 pos 3; el re-anclaje */
/* anti-fuga (R3-cas d) es reactivo a intDiameter — labio con sealOverlapMm).  */
/* -------------------------------------------------------------------------- */

function MateBodyMesh() {
  const mateModel = useEditorStore((s) => s.mateModel);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const bodyPreset = useEditorStore((s) => s.bodyPreset);
  const bodyColor = useEditorStore((s) => s.bodyColor);

  const geometry = useMemo(() => {
    const product = resolveMateModel(mateModel);
    return cached(`body:${product.id}:${intDiameter}`, () => buildBodyGeometry(product, intDiameter), bodyCache);
  }, [mateModel, intDiameter]);

  const material = useMemo(() => {
    const pbr = resolveBodyPbr(bodyPreset, bodyColor);
    const grain = woodGrainTexture();
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      roughness: pbr.roughness,
      metalness: pbr.metalness,
      map: grain ?? undefined,
      bumpMap: grain ?? undefined,
      bumpScale: 0.25,
    });
  }, [bodyPreset, bodyColor]);

  return <mesh geometry={geometry} material={material} castShadow={false} receiveShadow={false} />;
}

/* -------------------------------------------------------------------------- */
/* Grupo Virola (3 mallas, spec §3-R1 / prototipo v1):                        */
/*  1. Corona superior anular plana: donde se graba y van las guías.          */
/*  2. Faldón exterior: acabado metálico liso que cubre el labio anti-fuga.   */
/*  3. Pared interior: bajada hacia la boca del mate.                         */
/* -------------------------------------------------------------------------- */

function VirolaGroup() {
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const extDiameter = useEditorStore((s) => s.extDiameter);
  const mateModel = useEditorStore((s) => s.mateModel);
  const metalPreset = useEditorStore((s) => s.metalPreset);
  const virolaColor = useEditorStore((s) => s.virolaColor);

  const product = useMemo(() => resolveMateModel(mateModel), [mateModel]);
  const totalHeightMm = product.shape.totalHeightMm;
  const sealOverlapMm = product.shape.sealOverlapMm;

  // Cota Y de la corona superior: enrasada sobre el labio anti-fuga del mate
  const topY = totalHeightMm + sealOverlapMm;
  // Faldón exterior desciende cubriendo el labio y la costura del cuerpo
  const skirtBottomY = totalHeightMm - VIROLA_SKIRT_HEIGHT_MM + VIROLA_COVER_BELOW_SEAM_MM;
  // Pared interior desciende hacia el hueco de la boca
  const innerBottomY = topY - VIROLA_INNER_DROP_MM;

  const topGeometry = useMemo(
    () =>
      cached(
        `virolaTop:${intDiameter}:${extDiameter}`,
        () => buildVirolaTopGeometry(intDiameter, extDiameter),
        virolaCache,
      ),
    [intDiameter, extDiameter],
  );

  const outerWallGeometry = useMemo(
    () =>
      cached(
        `virolaOuter:${extDiameter}:${topY}:${skirtBottomY}`,
        () => buildVirolaOuterWallGeometry(extDiameter, topY, skirtBottomY),
        virolaCache,
      ),
    [extDiameter, topY, skirtBottomY],
  );

  const innerWallGeometry = useMemo(
    () =>
      cached(
        `virolaInner:${intDiameter}:${topY}:${innerBottomY}`,
        () => buildVirolaInnerWallGeometry(intDiameter, topY, innerBottomY),
        virolaCache,
      ),
    [intDiameter, topY, innerBottomY],
  );

  // R1/R2: material PBR único para las 3 mallas — cobertura integral de virola
  const virolaMaterial = useMemo(() => {
    const pbr = resolveVirolaPbr(metalPreset, virolaColor);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      metalness: pbr.metalness,
      roughness: pbr.roughness,
      side: THREE.DoubleSide,
    });
  }, [metalPreset, virolaColor]);

  return (
    <group>
      {/* 1. Corona superior plana: única que recibe grabado y guías */}
      <mesh geometry={topGeometry} material={virolaMaterial} position={[0, topY, 0]} castShadow receiveShadow />
      {/* 2. Faldón exterior: acabado metálico liso sin diseño ni guías */}
      <mesh geometry={outerWallGeometry} material={virolaMaterial} castShadow receiveShadow />
      {/* 3. Pared interior: bajada hacia la boca */}
      <mesh geometry={innerWallGeometry} material={virolaMaterial} />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Guias de simetría (R4/R5) — coplanares sobre la corona superior plana.     */
/* -------------------------------------------------------------------------- */

interface DashPattern {
  dashSize: number;
  gapSize: number;
}

/** Doble trazo R5/QA3: contorno oscuro translúcido debajo de la línea de color. */
function GuideStroke({ points, color, dash }: { points: THREE.Vector3[]; color: string; dash?: DashPattern }) {
  return (
    <>
      <Line
        points={points}
        color={GUIDE_BACK_STROKE.color}
        lineWidth={GUIDE_BACK_STROKE.widthPx}
        transparent
        opacity={GUIDE_BACK_STROKE.opacity}
        dashed={!!dash}
        dashSize={dash?.dashSize}
        gapSize={dash?.gapSize}
        depthWrite={false}
      />
      <Line
        points={points}
        color={color}
        lineWidth={GUIDE_FRONT_STROKE.widthPx}
        dashed={!!dash}
        dashSize={dash?.dashSize}
        gapSize={dash?.gapSize}
        depthWrite={false}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* R5 (pos 7) — pulso de desborde: cada guía de borde AFECTADA pasa a ROJO con */
/* un pulso de 500 ms mientras dura el estado. Es un OVERLAY encima de la      */
/* guía normal (grupo renderOrder 2; dWrite off para flotar sobre el grabado). */
/* -------------------------------------------------------------------------- */

/** R5: rojo de alerta de desborde — nota visual anotada (la spec pide "rojo"). */
const GUIDE_OVERFLOW_RED = '#FF3B30';
/** R5: "pulso de 500 ms" — período completo del ciclo de opacidad. */
const OVERFLOW_PULSE_PERIOD_S = 0.5;

function PulseGuideLine({ points, dash }: { points: THREE.Vector3[]; dash?: DashPattern }) {
  const lineRef = useRef<ComponentRef<typeof Line> | null>(null);

  useFrame(({ clock }) => {
    const line = lineRef.current;
    if (!line) return;
    const mat = line.material as THREE.Material & { opacity: number };
    // Opacidad 0.3 → 1 → 0.3 por ciclo (pulso continuo de 500 ms, R5).
    const t = (clock.elapsedTime % OVERFLOW_PULSE_PERIOD_S) / OVERFLOW_PULSE_PERIOD_S;
    mat.opacity = 0.3 + 0.7 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
  });

  return (
    <Line
      ref={lineRef}
      points={points}
      color={GUIDE_OVERFLOW_RED}
      lineWidth={2.2}
      dashed={!!dash}
      dashSize={dash?.dashSize}
      gapSize={dash?.gapSize}
      transparent
      depthWrite={false}
    />
  );
}

function GuidesLayer() {
  const ext = useEditorStore((s) => s.extDiameter);
  const int = useEditorStore((s) => s.intDiameter);
  const guidesState = useEditorStore((s) => s.guidesState);
  const mateModel = useEditorStore((s) => s.mateModel);
  /* R5 (pos 7): el estado de margen es DERIVADO — la envolvente de tinta de
   * sesión + R_ext/R_int vigentes + escala ⇒ el chequeo re-evalúa acá por los
   * 3 disparadores (escala, D_ext/D_int, carga de diseño). Jamás por
   * ángulo/espejo (invariancia polar R3). */
  const inkEnvelope = useEditorStore((s) => s.inkEnvelope);
  const inkScanDegraded = useEditorStore((s) => s.inkScanDegraded);
  const designScale = useEditorStore((s) => s.design.scale);

  const product = useMemo(() => resolveMateModel(mateModel), [mateModel]);
  const totalHeightMm = product.shape.totalHeightMm;
  const sealOverlapMm = product.shape.sealOverlapMm;

  const geo = useMemo(() => {
    // Corona superior plana + elevación ε sobre el metal (R4 coplanar)
    const yGuides = totalHeightMm + sealOverlapMm + GUIDE_SURFACE_OFFSET_MM;
    const rIn = int / 2;
    const rOut = ext / 2;
    const rCentro = (int + ext) / 4;

    return {
      // Bordes de chapa: 2 circunferencias concéntricas coplanares
      ringInner: guideCirclePoints(rIn, yGuides),
      ringOuter: guideCirclePoints(rOut, yGuides),
      // Línea central de posición: 1 circunferencia concéntrica coplanar
      ringCentro: guideCirclePoints(rCentro, yGuides),
      // Ejes simétricos 12h/6h: segmentos radiales sobre la corona superior plana
      axis12h: guideRadialAxisPoints(rIn, rOut, yGuides, 0),
      axis6h: guideRadialAxisPoints(rIn, rOut, yGuides, Math.PI),
      // Ticks transversales sobre la corona superior plana
      ticks12h: guideRadialAxisTicks(rIn, rOut, yGuides, 0),
      ticks6h: guideRadialAxisTicks(rIn, rOut, yGuides, Math.PI),
    };
  }, [ext, int, totalHeightMm, sealOverlapMm]);

  // R5 (pos 7): guías de bordes AFECTADAS pulsan en rojo 500 ms lo que dura
  // el estado. Modo degradado (§6): el trazo del chequeo cayó a envolvente
  // ⇒ el interior queda EN DUDA ⇒ pulsa conservadoramente (alerta de más).
  const burstOuter = useMemo(() => {
    if (!inkEnvelope) return false;
    return evaluateOverflow(inkEnvelope, ext / 2, int / 2, designScale).overflowOuter;
  }, [inkEnvelope, ext, int, designScale]);
  const burstInner = useMemo(() => {
    if (!inkEnvelope) return inkScanDegraded; // sin envolvente: solo el modo degradado avisa
    return evaluateOverflow(inkEnvelope, ext / 2, int / 2, designScale).overflowInner;
  }, [inkEnvelope, inkScanDegraded, ext, int, designScale]);

  return (
    <group renderOrder={2}>
      {guidesState.bordes && (
        <>
          {/* Bordes de chapa: punteado 4-3 #4FC3F7 — límites Dext / Dint de la corona superior */}
          <GuideStroke points={geo.ringInner} color={GUIDE_COLORS.bordes} dash={DASH_BORDES} />
          <GuideStroke points={geo.ringOuter} color={GUIDE_COLORS.bordes} dash={DASH_BORDES} />
          {/* R5 (pos 7): overlay rojo pulsante SOBRE las guías afectadas */}
          {burstInner && <PulseGuideLine points={geo.ringInner} dash={DASH_BORDES} />}
          {burstOuter && <PulseGuideLine points={geo.ringOuter} dash={DASH_BORDES} />}
        </>
      )}
      {guidesState.centro && (
        /* Línea central de posición: punteado 6-4 #FFC84A */
        <GuideStroke points={geo.ringCentro} color={GUIDE_COLORS.centro} dash={DASH_CENTRO} />
      )}
      {guidesState.ejes && (
        <>
          {/* Ejes radiales 12h/6h + ticks #FF7043 */}
          <GuideStroke points={geo.axis12h} color={GUIDE_COLORS.ejes} />
          <GuideStroke points={geo.axis6h} color={GUIDE_COLORS.ejes} />
          <Line
            points={geo.ticks12h}
            segments
            color={GUIDE_COLORS.ejes}
            lineWidth={GUIDE_AXIS_STROKE.widthPx}
            depthWrite={false}
          />
          <Line
            points={geo.ticks6h}
            segments
            color={GUIDE_COLORS.ejes}
            lineWidth={GUIDE_AXIS_STROKE.widthPx}
            depthWrite={false}
          />
        </>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Grabado del diseño (posiciones 6–7) — CanvasTexture viva 2048² sobre la    */
/* corona + mapa de relieve para la lectura de marca láser.                   */
/* R1/R4 (marco canónico): el canvas de la corona proyecta UV polar centrada  */
/* x/(2R)+0.5 (lathe-builder) ⇒ px = C+x·s / py = C−z·s con flipY del texture: */
/* el +Z (Frente con la cámara por defecto) es el borde SUPERIOR del canvas y */
/* por eso `rotate(+θ)` en canvas ≡ `rotateY(+θ)` en mundo ≡ giro visual      */
/* horario: 0° Frente / 90° Der / 180° Dorso / 270° Izq (presets EXACTAMENTE   */
/* como los nombra la spec R4). La costura lathe (ancla de guías pos 4) queda  */
/* al DORSO — nota visual anotada: 0° del DISEÑO es el frente del canvas.     */
/* R2 (pos 7 = spec_escala...): pipeline canónico ESCALA → ESPEJO → ROTACIÓN  */
/* compositadas AL MISMO PIVOTE (centro del carril = origen X:50% Y:50%).     */
/* R1 (pos 7): el ANCLAJE del 100 % ya vive en el ráster (contain-fit R8 de   */
/* pos 6 = envolvente tocando el anillo); el asset congela su base en mm      */
/* (baseSideMm = D_ext vigente al cargar) y el % multiplica SOLO esa base —   */
/* editar D_ext/D_int después NO re-escala el diseño, solo re-chequea.        */
/* R8: trabajo en vivo 2048² con smoothing 'high' (el SVG se rasteriza a esa  */
/* resolución FINAL en design-card); la Ficha HD re-proyecta a 2048². La      */
/* CanvasTexture del grabado usa anisotropía MÁXIMA: la virola vista de       */
/* perfil no se desenfoca por el mipmap en ángulos rasantes.                  */
/* Clipping anular con máscara destination-in SOLO entre R_int y R_ext, y     */
/* tinte ÚNICO con el tono del quemado adaptativo R4 (pos 5 → pos 7: el modo  */
/* de quemado no altera la escala). El bumpMap se DERIVA del mismo canvas     */
/* compuesto (composeEngravingHeightCanvas): trazo mate y rebajado, no una    */
/* calcomanía plana. El motor de desborde (R4 de spec_escala...) vive en      */
/* lib/overflow + OverflowMonitor: supervisores al composite de la ESCENA     */
/* (guías pulsan rojo vía el overlay de GuidesLayer).                         */
/* -------------------------------------------------------------------------- */

const ENGRAVING_CANVAS_PX = 2048; // R8: canvas de trabajo en vivo (SVG nítido)

/* El compositor del grabado (pipeline ESCALA→ESPEJO→ROTACIÓN al mismo pivote)
 * vive en `lib/compose-engraving.ts` — ÚNICA FUENTE compartida con la Ficha HD
 * (pos 9 llama con 2048²; acá el trabajo en vivo también es 2048²). */

function DesignEngravingLayer() {
  const int = useEditorStore((s) => s.intDiameter);
  const ext = useEditorStore((s) => s.extDiameter);
  const mateModel = useEditorStore((s) => s.mateModel);
  const virolaColor = useEditorStore((s) => s.virolaColor);
  const rotation = useEditorStore((s) => s.design.rotation);
  const mirror = useEditorStore((s) => s.design.mirror);
  const scale = useEditorStore((s) => s.design.scale);
  const asset = useEditorStore((s) => s.designAsset);

  const product = useMemo(() => resolveMateModel(mateModel), [mateModel]);
  const topY = product.shape.totalHeightMm + product.shape.sealOverlapMm;

  // MISMA geometría que VirolaGroup (misma cache ⇒ comparte buffers: ángulo,
  // escala y espejo JAMÁS reconstruyen la virola — spec §3 comportamiento).
  const geometry = useMemo(
    () => cached(`virolaTop:${int}:${ext}`, () => buildVirolaTopGeometry(int, ext), virolaCache),
    [int, ext],
  );

  // Tono/selector de quemado adaptativo (R4 pos 5): preset metálico ⇒ oscuro.
  const burn = useMemo(() => adaptiveLaserBurn(virolaColor), [virolaColor]);

  const { canvas, heightCanvas, texture, heightTexture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = ENGRAVING_CANVAS_PX;
    c.height = ENGRAVING_CANVAS_PX;
    const h = document.createElement('canvas');
    h.width = ENGRAVING_CANVAS_PX;
    h.height = ENGRAVING_CANVAS_PX;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const heightTex = new THREE.CanvasTexture(h);
    // Mapa de datos (altura), NO color: sin conversión sRGB.
    heightTex.colorSpace = THREE.NoColorSpace;
    return { canvas: c, heightCanvas: h, texture: tex, heightTexture: heightTex };
  }, []);

  // Nitidez de la virola vista de PERFIL (ángulo rasante): sin anisotropía el
  // mipmap colapsa y el grabado se ve borroso al acercarse al borde — igual
  // que hacía la textura del prototipo Mate Studio (máximo que dé la GPU).
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = maxAnisotropy;
    heightTexture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [texture, heightTexture, gl]);

  // (a)+(c) del flujo §3: cada cambio de ángulo/escala/espejo/diametros
  // NORMALIZADO re-composita y emite la textura — sin reconstruir virola ni
  // re-inicializar luces. El relieve se deriva del canvas recién compuesto.
  useEffect(() => {
    composeEngravingCanvas(canvas, asset?.canvas ?? null, rotation, mirror, scale, burn, int / 2, ext / 2);
    composeEngravingHeightCanvas(heightCanvas, canvas);
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [
    canvas,
    heightCanvas,
    texture,
    heightTexture,
    asset,
    rotation,
    mirror,
    scale,
    burn,
    int,
    ext,
  ]);

  const material = useMemo(
    () => createEngravingMaterial(texture, heightTexture, burn.opacity),
    [texture, heightTexture],
  );

  useEffect(() => {
    material.opacity = burn.opacity;
  }, [material, burn.opacity]);

  if (!asset) return null; // sin diseño: la corona sale lisa (nada que grabar)

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, topY + ENGRAVING_LIFT_MM, 0]}
      renderOrder={1} /* virola 0 < grabado 1 < guías 2 */
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Auto-giro (R7): rota el GRUPO producto a 0.75 RPM. Pausar ⇒ ángulo congelado*/
/* en el valor actual (reanudación por botón sin reencuadrar nada).           */
/* -------------------------------------------------------------------------- */

function AutoSpin({
  enabled,
  groupRef,
}: {
  enabled: boolean;
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const speed = rpmToRadPerSec(EDITOR_AUTO_SPIN_RPM); // 0.75 RPM ⇒ 4.5°/s

  useFrame((_, delta) => {
    if (!enabled) return;
    const group = groupRef.current;
    if (group) group.rotation.y += speed * Math.min(delta, 0.1); // clamp anti-salto tras tab inactiva
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Cámara: encuadre de producto (R8 viewport) + VISTA DE GRABADO de la corona */
/* -------------------------------------------------------------------------- */
/* La vista de producto es 3/4 y lee la silueta completa, pero deja el anillo  */
/* de la corona casi de canto. "Ver grabado" inclina la cámara a la misma      */
/* dirección cenital de la ficha (≈15°) y encuadra SOLO el anillo: el trazado  */
/* se lee en el 3D, no apenas en la tarjeta de vista previa. La transición es  */
/* una animación de posición + punto de mira (sin cortes ni saltos de órbita). */
/* -------------------------------------------------------------------------- */

/** Lo mínimo que usamos del OrbitControls (makeDefault) para animar el target. */
interface OrbitLikeControls {
  target: THREE.Vector3;
  update: () => void;
}

interface CameraAnim {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  durationMs: number;
}

interface EngravingPose {
  target: [number, number, number];
  /** Posición ABSOLUTA de cámara con el grupo producto en 0° (mm). */
  position: [number, number, number];
  distance: number;
  /** Termo: la cámara acompaña el giro del grupo para no perder el grabado. */
  followGroupSpin: boolean;
}

/** Dirección cámara→target; en el termo suma el ángulo actual del auto-giro. */
function engravingDirection(pose: EngravingPose, spinRad: number): THREE.Vector3 {
  const dir = new THREE.Vector3(...pose.position).sub(new THREE.Vector3(...pose.target));
  if (pose.followGroupSpin) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spinRad);
  return dir.normalize();
}

function CameraDirector({
  engravingView,
  groupRef,
}: {
  engravingView: boolean;
  groupRef: RefObject<THREE.Group | null>;
}) {
  const mateModel = useEditorStore((s) => s.mateModel);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const extDiameter = useEditorStore((s) => s.extDiameter);
  const rotation = useEditorStore((s) => s.design.rotation);
  const scale = useEditorStore((s) => s.design.scale);
  const designAsset = useEditorStore((s) => s.designAsset);
  const offsetYPct = useEditorStore((s) => s.thermo.offsetYPct);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLikeControls | null;
  const size = useThree((s) => s.size);
  const animRef = useRef<CameraAnim | null>(null);
  const modeRef = useRef(engravingView);
  modeRef.current = engravingView;

  const catalogProduct = useMemo(() => resolveProduct(mateModel), [mateModel]);
  const thermo = isThermoProduct(catalogProduct) ? catalogProduct : null;
  const product = useMemo(() => resolveMateModel(mateModel), [mateModel]);
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const productTargetY = thermo ? thermoFramingMm(thermo.thermo).centerYMm : CAMERA_TARGET_Y_MM;

  /* Distancia de producto: centro visual de la FAMILIA (mate o termo). */
  const productDistance = useMemo(() => {
    const sphereRadiusMm = thermo
      ? thermoFramingMm(thermo.thermo).sphereRadiusMm
      : productFramingMm(product, intDiameter, extDiameter).sphereRadiusMm;
    return fitCameraDistanceMm(sphereRadiusMm, aspect);
  }, [thermo, product, intDiameter, extDiameter, aspect]);

  /* Pose de grabado: en el mate es la corona; en el termo, la pared lateral.
   * El termo ENFRENTA el diseño (su ángulo puede ser cualquiera del arco libre)
   * y centra la mirada en la posición vertical elegida, no siempre en el frente
   * +Z ni en el centro de la zona. */
  const crownPose = useMemo<EngravingPose>(() => {
    if (thermo) {
      const spec = thermo.thermo;
      const surface = thermoSurface(spec);
      const assetAspect = thermoAssetAspect(designAsset?.canvas ?? null);
      const size = thermoDesignSizeMm(spec, assetAspect, scale);
      const slackY = Math.max(0, (surface.heightMm - size.heightMm) / 2);
      const targetY =
        surface.centerYMm + (normalizeThermoOffset(offsetYPct) / 100) * slackY;
      const angleRad = (clampThermoRotation(spec, rotation, scale, assetAspect) * Math.PI) / 180;
      const distance = fitCameraDistanceMm(
        Math.max(surface.heightMm / 2, size.widthMm / 2, spec.radiusMm * 0.9),
        aspect,
        CAMERA_FOV_DEG,
        ENGRAVING_VIEW_FIT_MARGIN,
      );
      const dir = new THREE.Vector3(Math.sin(angleRad), 0.18, Math.cos(angleRad)).normalize();
      return {
        target: [0, targetY, 0],
        position: [
          dir.x * distance,
          targetY + dir.y * distance,
          dir.z * distance,
        ] as [number, number, number],
        distance,
        followGroupSpin: true,
      };
    }
    return { ...engravingViewPoseMm(product, extDiameter, aspect), followGroupSpin: false };
  }, [thermo, product, extDiameter, aspect, rotation, scale, designAsset, offsetYPct]);

  /* Los efectos de transición leen la pose vigente sin re-dispararse por
   * cambios de tamaño/producto (esos los cubre el segundo efecto). */
  const poseRef = useRef({ productDistance, crownPose });
  poseRef.current = { productDistance, crownPose };

  // Cambio de vista (producto ⇄ grabado): posición + punto de mira juntos.
  useEffect(() => {
    if (!controls) return;
    const { productDistance: fitDist, crownPose: crown } = poseRef.current;
    const toTarget = engravingView
      ? new THREE.Vector3(...crown.target)
      : new THREE.Vector3(0, productTargetY, 0);
    const dir = engravingView
      ? engravingDirection(crown, groupRef.current?.rotation.y ?? 0)
      : new THREE.Vector3(...CAMERA_OFFSET_MM).normalize();
    const distance = engravingView ? crown.distance : fitDist;
    animRef.current = {
      fromPos: camera.position.clone(),
      toPos: toTarget.clone().addScaledVector(dir, distance),
      fromTarget: controls.target.clone(),
      toTarget,
      start: performance.now(),
      durationMs: 520,
    };
  }, [engravingView, controls, camera, productTargetY, groupRef]);

  // Cambio de producto / diámetros / tamaño del panel: en la vista de grabado
  // re-encuadra la corona; en la de producto conserva la órbita del usuario y
  // solo corrige la distancia (misma regla del refit: anima si supera el 2 %).
  // Si cambió el CENTRO vertical (mate ⇄ termo) el efecto de vista ya animó
  // target + posición: acá no se debe pisar con el target viejo.
  const prevTargetYRef = useRef(productTargetY);
  useEffect(() => {
    const targetYChanged = prevTargetYRef.current !== productTargetY;
    prevTargetYRef.current = productTargetY;
    if (!controls || targetYChanged) return;
    const { productDistance: fitDist, crownPose: crown } = poseRef.current;
    if (modeRef.current) {
      const toTarget = new THREE.Vector3(...crown.target);
      const dir = engravingDirection(crown, groupRef.current?.rotation.y ?? 0);
      animRef.current = {
        fromPos: camera.position.clone(),
        toPos: toTarget.clone().addScaledVector(dir, crown.distance),
        fromTarget: controls.target.clone(),
        toTarget,
        start: performance.now(),
        durationMs: 320,
      };
      return;
    }
    const current = camera.position.distanceTo(controls.target);
    if (Math.abs(fitDist - current) > current * 0.02) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      const target = controls.target.clone();
      animRef.current = {
        fromPos: camera.position.clone(),
        toPos: target.clone().addScaledVector(dir, fitDist),
        fromTarget: target.clone(),
        toTarget: target,
        start: performance.now(),
        durationMs: 320,
      };
    }
  }, [productDistance, crownPose, controls, camera, groupRef, productTargetY]);

  useFrame(() => {
    const anim = animRef.current;
    if (!anim) return;
    const t = Math.min(1, (performance.now() - anim.start) / anim.durationMs);
    const eased = 1 - (1 - t) ** 3; // easeOutCubic
    camera.position.lerpVectors(anim.fromPos, anim.toPos, eased);
    if (controls) {
      controls.target.lerpVectors(anim.fromTarget, anim.toTarget, eased);
      controls.update();
    }
    if (t >= 1) animRef.current = null;
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Marca de agua "MODO DEMO" (pos 8, spec_autenticacion §3-R4) — COCIDA AL     */
/* RENDER: tras el pase principal, una segunda pasada ortográfica pinta la     */
/* banda diagonal EN EL MISMO canvas WebGL (autoClear off + clearDepth + render*/
/* del overlay). Las capturas del SO la incluyen (límite declarado R4) y no    */
/* existe overlay DOM que arrancar. Se monta SOLO con plan 'free' (matriz R2:  */
/* la shell griega la prop; pro/pro_grace ven el render limpio, gate()).       */
/* -------------------------------------------------------------------------- */

/** R4: texto EXACTO del demo. */
const WATERMARK_TEXT_HEAD = 'MODO DEMO';
const WATERMARK_TEXT_REST = ' · Suscribite para descargar en HD';
const WATERMARK_BAND_FRACTION = 0.78; // ancho de la banda ≈ fracción del viewport
const WATERMARK_SKEW_DEG = -9; // banda "cruzada" (R4) sobre el centro del render
const WATERMARK_OPACITY = 0.3; // semitransparente: el producto sigue leyéndose

/** Textura de la banda: texto diagonal con contorno oscuro suave (legible
 * sobre metal claro y oscuro). Canvas transparente — sin fondo legal. */
function buildWatermarkTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas no disponible');
  const headPx = 128;
  const restPx = 68;
  const fontOf = (px: number, weight: number) =>
    `${weight} ${px}px system-ui, 'Segoe UI', -apple-system, sans-serif`;

  ctx.save();
  ctx.font = fontOf(headPx, 800);
  const headW = ctx.measureText(WATERMARK_TEXT_HEAD).width;
  ctx.font = fontOf(restPx, 600);
  const restW = ctx.measureText(WATERMARK_TEXT_REST).width;
  const gapPx = 16;
  const total = headW + restW + gapPx;
  const fit = Math.min(1, (w * 0.94) / total); // nunca recortar texto: escalea
  const headScale = headPx * fit;
  const restScale = restPx * fit;
  const gapScale = gapPx * fit;
  const totalScale = (headW + restW) * fit + gapScale;

  ctx.translate(w / 2, h / 2);
  ctx.rotate((WATERMARK_SKEW_DEG * Math.PI) / 180);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Halo oscuro + relleno cálido legible: la misma paleta de la escena.
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 16;
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(11,11,13,0.45)';
  ctx.fillStyle = 'rgba(255,244,224,0.94)';
  let x = -(totalScale / 2);
  ctx.font = fontOf(headScale, 800);
  ctx.strokeText(WATERMARK_TEXT_HEAD, x, 0);
  ctx.fillText(WATERMARK_TEXT_HEAD, x, 0);
  x += headW * fit + gapScale;
  ctx.font = fontOf(restScale, 600);
  ctx.strokeText(WATERMARK_TEXT_REST, x, 0);
  ctx.fillText(WATERMARK_TEXT_REST, x, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function WatermarkLayer() {
  /* Escena ortográfica PROPIA (2 NDC × 2 NDC): no vive en el árbol R3F, así el
   * raycaster/pointer y el resto de capas jamás la ven. */
  const overlay = useMemo(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.MeshBasicMaterial({
      map: buildWatermarkTexture(),
      transparent: true,
      opacity: WATERMARK_OPACITY,
      depthTest: false, // pinta SIEMPRE sobre el render (es un sello, no una superficie)
      depthWrite: false,
      toneMapped: false, // texto puro del sello: sin tonemapping del pipeline PBR
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.renderOrder = 999;
    scene.add(mesh);
    return { scene, camera, mesh, material };
  }, []);

  useEffect(
    () => () => {
      (overlay.mesh.geometry as THREE.BufferGeometry).dispose();
      overlay.material.map?.dispose();
      overlay.material.dispose();
    },
    [overlay],
  );

  /* priority 1 ⇒ R3F delega el render a esto callback (patrón de pasadas
   * custom): 1° la ESCENA principal (manual), 2° el sello por encima. */
  useFrame(({ gl, scene, camera }) => {
    const el = gl.domElement;
    const aspect = el.height > 0 ? el.width / el.height : 1;
    // PlaneGeometry(2,2) ⇒ ancho completo = 2 NDC: scale.x = fracción de ancho.
    // scale.y preserva píxeles cuadrados: frac * (texH/texW) * aspect.
    overlay.mesh.scale.set(
      WATERMARK_BAND_FRACTION,
      (512 / 2048) * WATERMARK_BAND_FRACTION * aspect,
      1,
    );
    gl.render(scene, camera); // pase principal (manual: priority > 0)
    gl.autoClear = false; // la pasada del sello NO borra el producto recién pintado
    gl.clearDepth();
    gl.render(overlay.scene, overlay.camera);
    gl.autoClear = true; // restablece para el clear del frame siguiente
  }, 1);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Producto TERMO en el estudio: mismo modelo que el visor, con arrastre      */
/* -------------------------------------------------------------------------- */

function ThermoStudioProduct({
  product,
  onInteract,
  onDraggingChange,
}: {
  product: ThermoProduct;
  /** Pausa el auto-giro al agarrar el grabado (misma regla que la órbita). */
  onInteract?: () => void;
  /** Bloquea OrbitControls mientras se arrastra el grabado sobre el cuerpo. */
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const bodyColor = useEditorStore((s) => s.bodyColor);
  const finish = useEditorStore((s) => s.thermo.finish);
  const rotation = useEditorStore((s) => s.design.rotation);
  const scale = useEditorStore((s) => s.design.scale);
  const mirror = useEditorStore((s) => s.design.mirror);
  const offsetYPct = useEditorStore((s) => s.thermo.offsetYPct);
  const invert = useEditorStore((s) => s.thermo.invert);
  const asset = useEditorStore((s) => s.designAsset);
  const setDesignRotation = useEditorStore((s) => s.setDesignRotation);
  const setThermoOffset = useEditorStore((s) => s.setThermoOffset);

  const aspect = useMemo(() => thermoAssetAspect(asset?.canvas ?? null), [asset]);

  const handleDrag = useCallback(
    (patch: { rotationDeg?: number; offsetYPct?: number }) => {
      if (typeof patch.rotationDeg === 'number') {
        setDesignRotation(
          clampThermoRotation(product.thermo, patch.rotationDeg, scale, aspect),
        );
      }
      if (typeof patch.offsetYPct === 'number') setThermoOffset(patch.offsetYPct);
    },
    [product.thermo, scale, aspect, setDesignRotation, setThermoOffset],
  );

  return (
    <ThermoProductView
      product={product}
      bodyColor={bodyColor}
      finish={finish}
      rotationDeg={rotation}
      scalePct={scale}
      mirror={mirror}
      offsetYPct={offsetYPct}
      invert={invert}
      asset={asset?.canvas ?? null}
      onDrag={handleDrag}
      onDragStateChange={(dragging) => {
        onDraggingChange?.(dragging);
        if (dragging) onInteract?.();
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Escena completa                                                            */
/* -------------------------------------------------------------------------- */

export interface StudioSceneProps {
  /** R7: auto-giro del editor activo/inactivo (pausa por interacción incluida). */
  spinning?: boolean;
  /** Pausa instantánea: OrbitControls 'start' (pointer-down/drag/pinch/scroll). */
  onUserInteracted?: () => void;
  /** R4 (pos 8): marca de agua MODO DEMO cocida al render — SOLO plan free. */
  watermark?: boolean;
  /** Vista cenital del anillo de grabado (botón "Ver grabado" del editor). */
  engravingView?: boolean;
}

export default function StudioScene({
  spinning = false,
  onUserInteracted,
  watermark = false,
  engravingView = false,
}: StudioSceneProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  const mateModel = useEditorStore((s) => s.mateModel);
  const catalogProduct = useMemo(() => resolveProduct(mateModel), [mateModel]);
  const thermo = isThermoProduct(catalogProduct) ? catalogProduct : null;
  /* Mientras se mueve el grabado con el dedo, la cámara no orbita: el diseño
   * sigue al puntero y no al revés. */
  const [thermoDragging, setThermoDragging] = useState(false);
  /* Punto de mira INICIAL congelado: si el prop `target` cambiara al cruzar de
   * familia, R3F lo aplicaría en el commit (antes de los efectos) y la cámara
   * saltaría. CameraDirector anima el target cuando el producto cambia. */
  const initialTargetYRef = useRef<number | null>(null);
  if (initialTargetYRef.current === null) {
    initialTargetYRef.current = thermo
      ? thermoFramingMm(thermo.thermo).centerYMm
      : CAMERA_TARGET_Y_MM;
  }
  const initialTargetY = initialTargetYRef.current;
  /* Identidad ESTABLE: el OrbitControls no debe re-aplicar el target en cada
   * render (pisaría el punto de mira animado por CameraDirector). */
  const defaultOrbitTarget = useMemo(
    () => [0, initialTargetY, 0] as [number, number, number],
    [initialTargetY],
  );

  return (
    <Canvas
      camera={{
        fov: CAMERA_FOV_DEG,
        position: [
          CAMERA_OFFSET_MM[0],
          initialTargetY + CAMERA_OFFSET_MM[1],
          CAMERA_OFFSET_MM[2],
        ],
        near: 1,
        far: 4000,
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#0b0b0d']} />
      <StudioEnvironment />
      <hemisphereLight intensity={0.55} groundColor="#14100c" color="#fff4e0" />
      <directionalLight position={[200, 260, 220]} intensity={1.15} color="#ffe9c4" />
      <directionalLight position={[-220, 90, -160]} intensity={0.5} color="#9fb4d8" />
      <pointLight position={[0, 40, 170]} intensity={250} distance={600} color="#ffd9a0" />

      {/* El producto (cuerpo + 3 mallas de virola + guías) es UN grupo: el auto-giro (R7) y
          el re-anclaje R3 comparten él — las guías giran con la virola (R4). */}
      <group ref={groupRef}>
        {thermo ? (
          <ThermoStudioProduct
            product={thermo}
            onInteract={onUserInteracted}
            onDraggingChange={setThermoDragging}
          />
        ) : (
          <>
            <MateBodyMesh />
            <VirolaGroup />
            <DesignEngravingLayer />
            <GuidesLayer />
          </>
        )}
      </group>

      {/* Suelo invisible: mismo color que el fondo para que no aparezca el
          borde del disco como una línea de horizonte detrás del mate. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[1200, 64]} />
        <meshBasicMaterial color="#0b0b0d" toneMapped={false} />
      </mesh>

      <AutoSpin enabled={spinning} groupRef={groupRef} />
      <CameraDirector engravingView={engravingView} groupRef={groupRef} />
      {/* Pos 8 R4: el sello MODO DEMO SOLO para plan free (prop de la shell:
          gate('render.no-watermark') es falso ⇒ prop false ⇒ sin overlay). */}
      {watermark && <WatermarkLayer />}
      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        enabled={!(thermo && thermoDragging)}
        target={defaultOrbitTarget}
        onStart={onUserInteracted}
      />
    </Canvas>
  );
}
