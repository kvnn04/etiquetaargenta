'use client';

/* ============================================================================
 * ESCENA 3D DEL MODO CLIENTE — visor público /v/[linkId] (posición 10A)
 * ÚNICA FUENTE: spec_ficha_comercial_interactiva_shareable_link.md §4 (Ver)
 * ----------------------------------------------------------------------------
 * MISMA LIBRERÍA que la escena del editor (lathe-builder, PBR de color,
 * compositor canónico del grabado y RPM→rad) — pero PARAMETERIZADA por el
 * payload congelado (view-shape) en vez del store del editor: el visitante
 * no tiene sesión, proyecto ni tools.
 *   · SIN guías técnicas, SIN medidas, SIN sliders, SIN marca de agua (§6:
 *     "jamás expone numeraciones… ni en UI ni en DOM");
 *   · giro tenue 0.5 RPM pausable POR EL DEDO: se frena en OrbitControls
 *     'start' y se reanuda en 'end' (el ritmo del giro y la órbita jamás se
 *     resetean — QA3 del swap A↔B);
 *   · cámara fijada UNA vez por el payload (plantilla del CameraRefit del
 *     editor: distancia por silhouette + margen 35%);
 *   · crossfade de variante ≤300 ms: composición de DOS capas del grabado
 *     (la que sale sobre la que entra, alpha animada por el padre) DENTRO de
 *     la misma textura — la malla y los materiales ni se enteran.
 * ============================================================================ */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { resolveMateModel } from '@/lib/catalog';
import { adaptiveLaserBurn, resolveBodyPbr, resolveVirolaPbr } from '@/lib/color';
import { composeEngravingCanvas } from '@/lib/compose-engraving';
import { rpmToRadPerSec } from '@/lib/virola';
import {
  buildBodyGeometry,
  buildVirolaTopGeometry,
  buildVirolaOuterWallGeometry,
  buildVirolaInnerWallGeometry,
} from '@/three/lathe-builder';
import {
  VIROLA_SKIRT_HEIGHT_MM,
  VIROLA_INNER_DROP_MM,
  VIROLA_COVER_BELOW_SEAM_MM,
} from '@/three/visual-skeleton';
import { LINK_VIEWER_SPIN_RPM } from '@/lib/links/states';
import type { PublicLinkView, PublicVariantView } from '@/lib/links/view-shape';

/** Mismo encuadre del editor (QA: la variante se presenta igual que en el estudio). */
const FIELD_OF_VIEW_DEG = 34;
const ENGRAVING_CANVAS_PX = 1024; // R8: mismo canvas de trabajo que la escena del editor
const ENGRAVING_LIFT_MM = 0.02;

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

/** Capa de grabado compuesta para el swap A/B/C (el paspa corre el rAF). */
export interface ViewerEngravingLayer {
  variant: PublicVariantView | null;
  asset: HTMLCanvasElement | null;
  /** Sincada en la que sale la capa NO ACTIVA (null ⇒ estado estable). */
  alpha: number;
}

/* -------------------------------------------------------------------------- */
/* Cuerpo + virola — mismas mallas/PBR del editor (caches separadas del       */
/* módulo del editor pero idénticas en construcción).                         */
/* -------------------------------------------------------------------------- */

function ViewerBody({ view }: { view: PublicLinkView }) {
  const geometry = useMemo(() => {
    const product = resolveMateModel(view.mate.modelId);
    return cached(`body:${product.id}:${view.mate.intDiameter}`, () => buildBodyGeometry(product, view.mate.intDiameter), bodyCache);
  }, [view.mate.modelId, view.mate.intDiameter]);

  const material = useMemo(() => {
    const pbr = resolveBodyPbr(view.mate.cupMaterial, view.mate.cupColor);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      roughness: pbr.roughness,
      metalness: pbr.metalness,
    });
  }, [view.mate.cupMaterial, view.mate.cupColor]);

  return <mesh geometry={geometry} material={material} castShadow={false} receiveShadow={false} />;
}

function ViewerVirola({ view }: { view: PublicLinkView }) {
  const product = useMemo(() => resolveMateModel(view.mate.modelId), [view.mate.modelId]);
  const { extDiameter, intDiameter } = view.mate;
  const totalHeightMm = product.shape.totalHeightMm;
  const sealOverlapMm = product.shape.sealOverlapMm;
  const topY = totalHeightMm + sealOverlapMm;
  const skirtBottomY = totalHeightMm - VIROLA_SKIRT_HEIGHT_MM + VIROLA_COVER_BELOW_SEAM_MM;
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

  const virolaMaterial = useMemo(() => {
    const pbr = resolveVirolaPbr(view.mate.metal, view.mate.virolaColor);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      metalness: pbr.metalness,
      roughness: pbr.roughness,
      side: THREE.DoubleSide,
    });
  }, [view.mate.metal, view.mate.virolaColor]);

  return (
    <group>
      <mesh geometry={topGeometry} material={virolaMaterial} position={[0, topY, 0]} castShadow receiveShadow />
      <mesh geometry={outerWallGeometry} material={virolaMaterial} castShadow receiveShadow />
      <mesh geometry={innerWallGeometry} material={virolaMaterial} />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Grabado con crossfade: UNA textura recompuesta por capa (máscara anular +  */
/* quemado iguales que el editor — la variante solo cambia sus 3 configs).    */
/* -------------------------------------------------------------------------- */

function ViewerEngraving({ view, layers }: { view: PublicLinkView; layers: ViewerEngravingLayer[] }) {
  const { extDiameter, intDiameter, virolaColor, modelId } = view.mate;
  const product = useMemo(() => resolveMateModel(modelId), [modelId]);
  const topY = product.shape.totalHeightMm + product.shape.sealOverlapMm;

  const geometry = useMemo(
    () =>
      cached(
        `virolaTop:${intDiameter}:${extDiameter}`,
        () => buildVirolaTopGeometry(intDiameter, extDiameter),
        virolaCache,
      ),
    [intDiameter, extDiameter],
  );

  const burn = useMemo(() => adaptiveLaserBurn(virolaColor), [virolaColor]);

  const { canvas, texture, offscreen } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = ENGRAVING_CANVAS_PX;
    c.height = ENGRAVING_CANVAS_PX;
    const o = document.createElement('canvas');
    o.width = ENGRAVING_CANVAS_PX;
    o.height = ENGRAVING_CANVAS_PX;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, texture: tex, offscreen: o };
  }, []);

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [texture, gl]);

  /* Capa 1 (nueva) abajo; capas que SALDEN encima con su alpha — crossfade
   * de textura sin tocar malla, materiales ni cámara (QA3). */
  useEffect(() => {
    const [main, ...fading] = layers;
    if (!main) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      composeEngravingCanvas(
        canvas,
        main.asset,
        main.variant?.rotationDeg ?? 0,
        main.variant?.mirror ?? false,
        main.variant?.scalePct ?? 100,
        burn,
        intDiameter / 2,
        extDiameter / 2,
      );
      if (fading.length > 0) {
        const ctx = canvas.getContext('2d');
        for (const fade of fading) {
          composeEngravingCanvas(
            offscreen,
            fade.asset,
            fade.variant?.rotationDeg ?? 0,
            fade.variant?.mirror ?? false,
            fade.variant?.scalePct ?? 100,
            burn,
            intDiameter / 2,
            extDiameter / 2,
          );
          if (!ctx) continue;
          ctx.globalAlpha = Math.max(0, Math.min(1, fade.alpha));
          ctx.drawImage(offscreen, 0, 0);
          ctx.globalAlpha = 1;
        }
      }
    }
    texture.needsUpdate = true;
  }, [canvas, texture, offscreen, layers, burn, intDiameter, extDiameter]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        opacity: burn.opacity,
        metalness: 0.05,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [texture, burn.opacity],
  );

  if (!layers[0]?.asset || !layers[0]?.variant) return null; // sin asset: corona lisa

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, topY + ENGRAVING_LIFT_MM, 0]}
      renderOrder={1}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Auto-giro 0.5 RPM (pausable por el dedo, se reanuda al soltar — §4).        */
/* -------------------------------------------------------------------------- */

function ViewerSpin({ enabled, groupRef }: { enabled: boolean; groupRef: React.RefObject<THREE.Group | null> }) {
  const speed = rpmToRadPerSec(LINK_VIEWER_SPIN_RPM);
  useFrame((_, delta) => {
    if (!enabled) return;
    const group = groupRef.current;
    if (group) group.rotation.y += speed * Math.min(delta, 0.1);
  });
  return null;
}

/* -------------------------------------------------------------------------- */
/* Escena completa                                                            */
/* -------------------------------------------------------------------------- */

export interface ViewerSceneProps {
  view: PublicLinkView;
  /** Capa ACTIVA del grabado + la que se desvanece (null ⇒ estable). */
  layer: ViewerEngravingLayer;
  fadeLayer: ViewerEngravingLayer | null;
  /** Pausa instantánea en OrbitControls 'start' (hint "Arrastrá…" sale acá). */
  onUserInteracted?: () => void;
}

export default function ViewerScene({ view, layer, fadeLayer, onUserInteracted }: ViewerSceneProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  /* Pausa/reanudación por gesto (§4: "pausable por el dedo"): se frena con el
   * dedo apoyado y el ritmo REANUDA al soltar — la órbita jamás se resetea. */
  const [spinning, setSpinning] = useState(true);

  /* Cámara fijada UNA vez por la silueta del payload (misma plantilla del
   * CameraRefit del editor: margen 35% + 40 de aire). */
  const camPos = useMemo(() => {
    const product = resolveMateModel(view.mate.modelId);
    const maxR = Math.max(
      ...product.shape.points.map((p) => p.x * (view.mate.intDiameter / 2)),
      view.mate.extDiameter / 2,
    );
    const heightTop = product.shape.totalHeightMm + product.shape.sealOverlapMm;
    const fov = (FIELD_OF_VIEW_DEG * Math.PI) / 180;
    const forRadius = (maxR * 1.35) / Math.tan(fov / 2);
    const forHeight = (heightTop * 1.3) / Math.tan(fov / 2);
    const dist = Math.max(forRadius, forHeight) + 40;
    return new THREE.Vector3(0, 150, 240).normalize().multiplyScalar(dist).toArray() as [number, number, number];
  }, [view.mate.modelId, view.mate.intDiameter, view.mate.extDiameter]);

  return (
    <Canvas
      camera={{ fov: FIELD_OF_VIEW_DEG, position: camPos, near: 1, far: 4000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#0b0b0d']} />
      <hemisphereLight intensity={0.55} groundColor="#14100c" color="#fff4e0" />
      <directionalLight position={[200, 260, 220]} intensity={1.15} color="#ffe9c4" />
      <directionalLight position={[-220, 90, -160]} intensity={0.5} color="#9fb4d8" />
      <pointLight position={[0, 40, 170]} intensity={250} distance={600} color="#ffd9a0" />

      <group ref={groupRef}>
        <ViewerBody view={view} />
        <ViewerVirola view={view} />
        <ViewerEngraving view={view} layers={fadeLayer ? [layer, fadeLayer] : [layer]} />
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[420, 48]} />
        <meshBasicMaterial color="#111114" />
      </mesh>

      <ViewerSpin enabled={spinning} groupRef={groupRef} />
      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        target={[0, 90, 0]}
        onStart={() => {
          setSpinning(false);
          onUserInteracted?.();
        }}
        onEnd={() => setSpinning(true)}
      />
    </Canvas>
  );
}
