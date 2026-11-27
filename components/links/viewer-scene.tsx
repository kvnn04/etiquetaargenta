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
import { resolveMateModel, resolveProduct, isThermoProduct } from '@/lib/catalog';
import { adaptiveLaserBurn, resolveBodyPbr, resolveVirolaPbr } from '@/lib/color';
import { composeEngravingCanvas, composeEngravingHeightCanvas } from '@/lib/compose-engraving';
import { normalizeThermoConfig, clampThermoRotation } from '@/lib/thermo';
import { thermoAssetAspect } from '@/lib/compose-thermo-engraving';
import { rpmToRadPerSec } from '@/lib/virola';
import ThermoProductView from '@/components/thermo/thermo-product';
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
import {
  CAMERA_FOV_DEG,
  CAMERA_OFFSET_MM,
  CAMERA_TARGET_Y_MM,
  fitCameraDistanceMm,
  productFramingMm,
  thermoFramingMm,
} from '@/three/framing';
import { StudioEnvironment } from '@/three/studio-environment';
import { woodGrainTexture } from '@/three/wood-grain';
import { createEngravingMaterial, ENGRAVING_LIFT_MM } from '@/three/engraving-material';

/** Mismo encuadre del editor (QA: la variante se presenta igual que en el estudio). */
const FIELD_OF_VIEW_DEG = CAMERA_FOV_DEG;
/* El asset publicado se re-encoda a ≤1024² (R3 de links): el canvas del visor
 * conserva esa resolución y el relieve se deriva de la misma máscara. */
const ENGRAVING_CANVAS_PX = 1024;

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
    const grain = woodGrainTexture();
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(pbr.color),
      roughness: pbr.roughness,
      metalness: pbr.metalness,
      map: grain ?? undefined,
      bumpMap: grain ?? undefined,
      bumpScale: 0.25,
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

  const { canvas, heightCanvas, texture, heightTexture, offscreen } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = ENGRAVING_CANVAS_PX;
    c.height = ENGRAVING_CANVAS_PX;
    const h = document.createElement('canvas');
    h.width = ENGRAVING_CANVAS_PX;
    h.height = ENGRAVING_CANVAS_PX;
    const o = document.createElement('canvas');
    o.width = ENGRAVING_CANVAS_PX;
    o.height = ENGRAVING_CANVAS_PX;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const heightTex = new THREE.CanvasTexture(h);
    heightTex.colorSpace = THREE.NoColorSpace;
    return { canvas: c, heightCanvas: h, texture: tex, heightTexture: heightTex, offscreen: o };
  }, []);

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = maxAnisotropy;
    heightTexture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [texture, heightTexture, gl]);

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
    // El relieve se deriva del canvas final (incluye el crossfade).
    composeEngravingHeightCanvas(heightCanvas, canvas);
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [
    canvas,
    heightCanvas,
    texture,
    heightTexture,
    offscreen,
    layers,
    burn,
    intDiameter,
    extDiameter,
  ]);

  const material = useMemo(
    () => createEngravingMaterial(texture, heightTexture, burn.opacity),
    [texture, heightTexture],
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
/* Encuadre del visor: se fija UNA vez con el aspecto real del contenedor.     */
/* -------------------------------------------------------------------------- */

function ViewerCameraFit({
  sphereRadiusMm,
  targetY,
}: {
  sphereRadiusMm: number;
  targetY: number;
}) {
  const { camera, size } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || size.width < 2 || size.height < 2) return;
    const target = new THREE.Vector3(0, targetY, 0);
    const dir = new THREE.Vector3(...CAMERA_OFFSET_MM).normalize();
    camera.position
      .copy(target)
      .addScaledVector(dir, fitCameraDistanceMm(sphereRadiusMm, size.width / size.height));
    fitted.current = true;
  }, [camera, size.width, size.height, sphereRadiusMm, targetY]);

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

  /* Familia congelada en el payload: el termo reusa su modelo compartido y su
   * propio encuadre vertical; el mate conserva el pipeline de siempre. */
  const catalogProduct = useMemo(() => resolveProduct(view.mate.modelId), [view.mate.modelId]);
  const thermo = isThermoProduct(catalogProduct) ? catalogProduct : null;
  const mateProduct = useMemo(
    () => (thermo ? null : resolveMateModel(view.mate.modelId)),
    [thermo, view.mate.modelId],
  );
  const thermoConfig = useMemo(() => normalizeThermoConfig(view.mate.thermo), [view.mate.thermo]);
  /* El payload pudo congelarse con un ángulo viejo fuera del arco libre: el
   * visor lo lleva al límite antes de componer (nunca tapa la manija). */
  const activeAspect = useMemo(() => thermoAssetAspect(layer.asset), [layer.asset]);
  const fadeAspect = useMemo(
    () => thermoAssetAspect(fadeLayer?.asset ?? null),
    [fadeLayer?.asset],
  );
  /* El termo arranca mostrando el GRABADO: se orienta el producto para llevar
   * el centro del diseño al frente (+Z) y el auto-giro sigue desde ahí. Sin
   * esto, un diseño a 90° quedaba de canto y tardaba medio minuto en entrar.
   * Se congela al primer render: un swap A/B/C no debe saltar la cámara. */
  const [initialRotationY] = useState(() => {
    if (!thermo || !layer.variant) return 0;
    const deg = clampThermoRotation(
      thermo.thermo,
      layer.variant.rotationDeg,
      layer.variant.scalePct,
      activeAspect,
    );
    return (-deg * Math.PI) / 180;
  });
  const groupRotation = useMemo<[number, number, number]>(
    () => [0, initialRotationY, 0],
    [initialRotationY],
  );

  const framing = useMemo(() => {
    if (thermo) {
      const f = thermoFramingMm(thermo.thermo);
      return { sphereRadiusMm: f.sphereRadiusMm, targetY: f.centerYMm };
    }
    const f = productFramingMm(
      mateProduct ?? resolveMateModel(null),
      view.mate.intDiameter,
      view.mate.extDiameter,
    );
    return { sphereRadiusMm: f.sphereRadiusMm, targetY: CAMERA_TARGET_Y_MM };
  }, [thermo, mateProduct, view.mate.intDiameter, view.mate.extDiameter]);

  const orbitTarget = useMemo(
    () => [0, framing.targetY, 0] as [number, number, number],
    [framing.targetY],
  );

  /* Posición inicial estimada (aspecto 1); ViewerCameraFit la corrige con el
   * aspecto real del contenedor antes del primer frame visible. */
  const camPos = useMemo(() => {
    const target = new THREE.Vector3(0, framing.targetY, 0);
    const dir = new THREE.Vector3(...CAMERA_OFFSET_MM).normalize();
    return target
      .clone()
      .addScaledVector(dir, fitCameraDistanceMm(framing.sphereRadiusMm, 1))
      .toArray() as [number, number, number];
  }, [framing]);

  return (
    <Canvas
      camera={{ fov: FIELD_OF_VIEW_DEG, position: camPos, near: 1, far: 4000 }}
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

      <group ref={groupRef} rotation={groupRotation}>
        {thermo ? (
          <ThermoProductView
            product={thermo}
            bodyColor={view.mate.cupColor}
            finish={thermoConfig.finish}
            rotationDeg={
              layer.variant
                ? clampThermoRotation(
                    thermo.thermo,
                    layer.variant.rotationDeg,
                    layer.variant.scalePct,
                    activeAspect,
                  )
                : 0
            }
            scalePct={layer.variant?.scalePct ?? thermo.thermo.defaultScalePct}
            mirror={layer.variant?.mirror ?? false}
            offsetYPct={thermoConfig.offsetYPct}
            invert={thermoConfig.invert}
            asset={layer.asset}
            fade={
              fadeLayer?.asset && fadeLayer.variant
                ? {
                    asset: fadeLayer.asset,
                    rotationDeg: clampThermoRotation(
                      thermo.thermo,
                      fadeLayer.variant.rotationDeg,
                      fadeLayer.variant.scalePct,
                      fadeAspect,
                    ),
                    scalePct: fadeLayer.variant.scalePct,
                    mirror: fadeLayer.variant.mirror,
                    alpha: fadeLayer.alpha,
                  }
                : null
            }
          />
        ) : (
          <>
            <ViewerBody view={view} />
            <ViewerVirola view={view} />
            <ViewerEngraving view={view} layers={fadeLayer ? [layer, fadeLayer] : [layer]} />
          </>
        )}
      </group>

      {/* Suelo invisible (mismo color que el fondo, sin tonemapping): no deja
          una línea de horizonte detrás del producto. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[1200, 64]} />
        <meshBasicMaterial color="#0b0b0d" toneMapped={false} />
      </mesh>

      <ViewerSpin enabled={spinning} groupRef={groupRef} />
      <ViewerCameraFit sphereRadiusMm={framing.sphereRadiusMm} targetY={framing.targetY} />
      <OrbitControls
        makeDefault
        enablePan
        enableDamping
        target={orbitTarget}
        onStart={() => {
          setSpinning(false);
          onUserInteracted?.();
        }}
        onEnd={() => setSpinning(true)}
      />
    </Canvas>
  );
}
