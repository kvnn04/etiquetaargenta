'use client';

/* ============================================================================
 * ESCENA 3D (posición 5) — spec_seleccion_de_color.md + spec_tecnica_geometrica
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
 *
 * R5 (desborde): el flash rojo de desborde (pos 7) se superpone por ENCIMA de
 * esta capa de guías mientras dure el estado (prevalece visualmente).
 * ============================================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { resolveMateModel } from '@/lib/catalog';
import { useEditorStore } from '@/lib/store/editor';
import { resolveBodyPbr, resolveVirolaPbr } from '@/lib/color';
import { EDITOR_AUTO_SPIN_RPM, rpmToRadPerSec } from '@/lib/virola';
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

/* Cámara por defecto: encuadra Camionero con margen (QA1/QA2 comparables). */
const FIELD_OF_VIEW_DEG = 34;
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
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      roughness: pbr.roughness,
      metalness: pbr.metalness,
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

function GuidesLayer() {
  const ext = useEditorStore((s) => s.extDiameter);
  const int = useEditorStore((s) => s.intDiameter);
  const guidesState = useEditorStore((s) => s.guidesState);
  const mateModel = useEditorStore((s) => s.mateModel);

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

  return (
    <group renderOrder={2}>
      {guidesState.bordes && (
        <>
          {/* Bordes de chapa: punteado 4-3 #4FC3F7 — límites Dext / Dint de la corona superior */}
          <GuideStroke points={geo.ringInner} color={GUIDE_COLORS.bordes} dash={DASH_BORDES} />
          <GuideStroke points={geo.ringOuter} color={GUIDE_COLORS.bordes} dash={DASH_BORDES} />
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
/* Cámara: refit SOLO si la nueva silueta excede el encuadre (R8 viewport).   */
/* -------------------------------------------------------------------------- */

function CameraRefit() {
  const mateModel = useEditorStore((s) => s.mateModel);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const extDiameter = useEditorStore((s) => s.extDiameter);
  const { camera } = useThree();
  const animRef = useRef<{ from: number; to: number; start: number } | null>(null);

  const requiredDistance = useMemo(() => {
    const product = resolveMateModel(mateModel);
    const maxR = Math.max(
      ...product.shape.points.map((p) => p.x * (intDiameter / 2)),
      extDiameter / 2, // la banda crece sólo hacia fuera (R1: Dext ≥ Dint+8)
    );
    const heightTop = product.shape.totalHeightMm + product.shape.sealOverlapMm;
    const fov = (FIELD_OF_VIEW_DEG * Math.PI) / 180;
    const forRadius = (maxR * 1.35) / Math.tan(fov / 2); // margen 35 %
    const forHeight = (heightTop * 1.3) / Math.tan(fov / 2);
    return Math.max(forRadius, forHeight) + 40;
  }, [mateModel, intDiameter, extDiameter]);

  // Cambio de producto / diámetros: anima SOLO si hace falta alejarse.
  useEffect(() => {
    const current = camera.position.length();
    if (requiredDistance > current * 1.02) {
      animRef.current = { from: current, to: requiredDistance, start: performance.now() };
    }
  }, [requiredDistance, camera]);

  useFrame(() => {
    const anim = animRef.current;
    if (!anim) return;
    const t = Math.min(1, (performance.now() - anim.start) / 300);
    const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
    const dist = anim.from + (anim.to - anim.from) * eased;
    camera.position.normalize().multiplyScalar(dist);
    if (t >= 1) animRef.current = null;
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Escena completa                                                            */
/* -------------------------------------------------------------------------- */

export interface StudioSceneProps {
  /** R7: auto-giro del editor activo/inactivo (pausa por interacción incluida). */
  spinning?: boolean;
  /** Pausa instantánea: OrbitControls 'start' (pointer-down/drag/pinch/scroll). */
  onUserInteracted?: () => void;
}

export default function StudioScene({ spinning = false, onUserInteracted }: StudioSceneProps) {
  const groupRef = useRef<THREE.Group | null>(null);

  return (
    <Canvas
      camera={{ fov: FIELD_OF_VIEW_DEG, position: [0, 150, 240], near: 1, far: 4000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#0b0b0d']} />
      <hemisphereLight intensity={0.55} groundColor="#14100c" color="#fff4e0" />
      <directionalLight position={[200, 260, 220]} intensity={1.15} color="#ffe9c4" />
      <directionalLight position={[-220, 90, -160]} intensity={0.5} color="#9fb4d8" />
      <pointLight position={[0, 40, 170]} intensity={250} distance={600} color="#ffd9a0" />

      {/* El producto (cuerpo + 3 mallas de virola + guías) es UN grupo: el auto-giro (R7) y
          el re-anclaje R3 comparten él — las guías giran con la virola (R4). */}
      <group ref={groupRef}>
        <MateBodyMesh />
        <VirolaGroup />
        <GuidesLayer />
      </group>

      {/* Suelo oscuro sutil (base visual del objeto; NO gira con el producto) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[420, 48]} />
        <meshBasicMaterial color="#111114" />
      </mesh>

      <AutoSpin enabled={spinning} groupRef={groupRef} />
      <CameraRefit />
      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        target={[0, 90, 0]}
        onStart={onUserInteracted}
      />
    </Canvas>
  );
}
