'use client';

/* ============================================================================
 * ESCENA 3D (posición 3) — spec_tipo_de_mate.md
 * ----------------------------------------------------------------------------
 * Canvas R3F con: cuerpo lathe desde el catálogo, banda metálica (virola
 * esqueleto), luces sin env-map (cero red al montar) y OrbitControls.
 *
 * R3 (inviolable): el swap de producto reconstruye ÚNICAMENTE el cuerpo —
 * la virola y las luces NO se re-inicializan (sin parpadeo, QA2).
 * R8 (viewport): si la silueta nueva excede el encuadre, la cámara aplica
 * un refit suave (~300 ms) sin resetear la órbita.
 * ============================================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { resolveMateModel } from '@/lib/catalog';
import { useEditorStore } from '@/lib/store/editor';
import { DEFAULT_EXT_DIAMETER_MM, VIROLA_BAND_HEIGHT_MM, VIROLA_COVER_BELOW_SEAM_MM } from '@/three/visual-skeleton';
import { buildBodyGeometry, buildVirolaGeometry } from '@/three/lathe-builder';

/* Cámara por defecto: encuadra Camionero con margen (QA1/QA2 comparables). */
const FIELD_OF_VIEW_DEG = 34;

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
/* Cuerpo: mesh de lathe del catálogo + crossfade de ~150 ms (§4).             */
/* -------------------------------------------------------------------------- */

function MateBodyMesh() {
  const mateModel = useEditorStore((s) => s.mateModel);
  const intDiameter = useEditorStore((s) => s.intDiameter);

  const geometry = useMemo(() => {
    const product = resolveMateModel(mateModel);
    return cached(`body:${product.id}:${intDiameter}`, () => buildBodyGeometry(product, intDiameter), bodyCache);
  }, [mateModel, intDiameter]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#8a5a33'), // esqueleto: madera algarrobo base (pos 5 = PBR real)
        roughness: 0.72,
        metalness: 0.05,
      }),
    [],
  );

  // Crossfade: la malla nueva entra con opacidad baja y sube a 1 en ~150 ms
  // (pseudo-fade perceptual; el swap es instantáneo — sin morph, QA2).
  const fadeStart = useRef(0);
  useEffect(() => {
    fadeStart.current = performance.now();
    material.transparent = true;
    material.opacity = 0.55;
    return undefined;
  }, [geometry, material]);

  useFrame(() => {
    if (!material.transparent) return;
    const elapsed = performance.now() - fadeStart.current;
    const t = Math.min(1, elapsed / 150);
    material.opacity = 0.55 + 0.45 * t;
    if (t >= 1) {
      material.transparent = false;
      material.opacity = 1;
      material.needsUpdate = true;
    }
  });

  // La geometría queda en mm (sin escalar): la cámara fija sus distancias en
  // el mismo rango para no mezclar unidades.
  return <mesh geometry={geometry} material={material} castShadow={false} receiveShadow={false} />;
}

/* -------------------------------------------------------------------------- */
/* Banda metálica (esqueleto de la virola — pos 4 la hace suya).               */
/* -------------------------------------------------------------------------- */

function VirolaMesh() {
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const totalHeight = useEditorStore((s) => {
    const p = resolveMateModel(s.mateModel);
    return p.shape.totalHeightMm;
  });

  const geometry = useMemo(
    () => cached(`virola:${intDiameter}`, () => buildVirolaGeometry(intDiameter, DEFAULT_EXT_DIAMETER_MM, VIROLA_BAND_HEIGHT_MM), virolaCache),
    [intDiameter],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#b9b3a8'),
        metalness: 0.9,
        roughness: 0.35,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Banda centrada de modo que su borde inferior quede 3 mm POR DEBAJO de la
  // costura (Y = totalHeight): cubre el labio R4 del cuerpo.
  const bottomY = totalHeight - VIROLA_COVER_BELOW_SEAM_MM;
  const centerY = bottomY + VIROLA_BAND_HEIGHT_MM / 2;

  return <mesh geometry={geometry} material={material} position={[0, centerY, 0]} />;
}

/* -------------------------------------------------------------------------- */
/* Cámara: refit SOLO si la nueva silueta excede el encuadre (R8 viewport).    */
/* -------------------------------------------------------------------------- */

function CameraRefit() {
  const mateModel = useEditorStore((s) => s.mateModel);
  const intDiameter = useEditorStore((s) => s.intDiameter);
  const { camera } = useThree();
  const animRef = useRef<{ from: number; to: number; start: number } | null>(null);

  const requiredDistance = useMemo(() => {
    const product = resolveMateModel(mateModel);
    const maxR = Math.max(
      ...product.shape.points.map((p) => p.x * (intDiameter / 2)),
      DEFAULT_EXT_DIAMETER_MM / 2,
    );
    const heightTop =
      product.shape.totalHeightMm + VIROLA_BAND_HEIGHT_MM - VIROLA_COVER_BELOW_SEAM_MM;
    const fov = (FIELD_OF_VIEW_DEG * Math.PI) / 180;
    const forRadius = (maxR * 1.35) / Math.tan(fov / 2); // margen 35 %
    const forHeight = (heightTop * 1.3) / Math.tan(fov / 2);
    return Math.max(forRadius, forHeight) + 40;
  }, [mateModel, intDiameter]);

  // Cambio de producto: anima SOLO si hace falta alejarse.
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

export default function StudioScene() {
  return (
    <Canvas
      camera={{ fov: FIELD_OF_VIEW_DEG, position: [0, 130, 260], near: 1, far: 4000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#0b0b0d']} />
      <hemisphereLight intensity={0.55} groundColor="#14100c" color="#fff4e0" />
      <directionalLight position={[200, 260, 220]} intensity={1.15} color="#ffe9c4" />
      <directionalLight position={[-220, 90, -160]} intensity={0.5} color="#9fb4d8" />
      <pointLight position={[0, 40, 170]} intensity={250} distance={600} color="#ffd9a0" />

      <MateBodyMesh />
      <VirolaMesh />

      {/* Suelo oscuro sutil (base visual del objeto, sin sombras reales) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[420, 48]} />
        <meshBasicMaterial color="#111114" />
      </mesh>

      <CameraRefit />
      <OrbitControls makeDefault enablePan enableDamping target={[0, 90, 0]} />
    </Canvas>
  );
}

/*
 * La textura de grabado (después de la posición 6) y las guías (posición 4)
 * se apoyan en el phiStart exportado (LATHE_SEAM_PHI_START, UV 0° = costura):
 * THREE.LatheGeometry ya lo recibe fijo desde lathe-builder.
 */
