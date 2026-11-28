'use client';

/* ============================================================================
 * PRODUCTO TERMO EN 3D — componente compartido por editor y visor público
 * ----------------------------------------------------------------------------
 * Recibe TODO por props (sin store) para que el mismo modelo sirva al editor
 * con sesión y al visor `/v/[linkId]` con payload congelado. El grabado vive en
 * un cilindro transparente sobre el cuerpo pintado; el arrastre (solo editor)
 * convierte el punto de impacto en ángulo + posición vertical.
 * ============================================================================ */

import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThermoProduct } from '@/lib/catalog';
import {
  clampThermoRotation,
  normalizeThermoOffset,
  thermoBodyPbr,
  thermoDesignSizeMm,
  thermoLaserBurn,
  thermoSurface,
  type ThermoFinish,
} from '@/lib/thermo';
import {
  composeThermoEngravingCanvas,
  thermoAssetAspect,
  thermoCanvasHeight,
} from '@/lib/compose-thermo-engraving';
import { composeEngravingHeightCanvas } from '@/lib/compose-engraving';
import {
  buildThermoBaseGeometry,
  buildThermoBodyGeometry,
  buildThermoCollarGeometry,
  buildThermoEngravingGeometry,
  buildThermoGrooveGeometry,
  buildThermoHandleGeometry,
  buildThermoLidGeometry,
  buildThermoSeamGeometry,
  thermoHandleLinks,
  thermoHandleMounts,
} from '@/three/thermo-builder';

const ENGRAVING_WIDTH_PX = 2048;

export interface ThermoDragPatch {
  rotationDeg?: number;
  offsetYPct?: number;
}

export interface ThermoProductProps {
  product: ThermoProduct;
  bodyColor: string | null;
  finish: ThermoFinish;
  rotationDeg: number;
  scalePct: number;
  mirror: boolean;
  offsetYPct: number;
  invert: boolean;
  asset: HTMLCanvasElement | null;
  /** Solo editor: mueve el grabado con el dedo/mouse sobre el cuerpo. */
  onDrag?: (patch: ThermoDragPatch) => void;
  onDragStateChange?: (dragging: boolean) => void;
  /** Solo visor: capa anterior del swap A/B/C, se compone con alpha decreciente. */
  fade?: {
    asset: HTMLCanvasElement;
    rotationDeg: number;
    scalePct: number;
    mirror: boolean;
    alpha: number;
  } | null;
}

function SteelMaterial({ color = '#E6EBF0' }: { color?: string }) {
  return (
    <meshStandardMaterial color={color} metalness={0.92} roughness={0.22} envMapIntensity={0.9} />
  );
}

function CollarMaterial() {
  return <meshStandardMaterial color="#16181D" metalness={0.15} roughness={0.48} />;
}

/** Silicona del aro de la botella: oscura, mate y sin brillo metálico. */
function SiliconeMaterial() {
  return <meshStandardMaterial color="#111317" metalness={0.05} roughness={0.85} />;
}

/**
 * R3F agrega `setPointerCapture`/`releasePointerCapture` al `target` del evento
 * en runtime, pero su tipo público lo declara como `EventTarget` pelado. Se
 * captura el puntero para que el arrastre sobreviva a salir del cuerpo.
 */
function capturePointer(e: ThreeEvent<PointerEvent>, on: boolean): void {
  const target = e.target as
    | (EventTarget & {
        setPointerCapture?: (pointerId: number) => void;
        releasePointerCapture?: (pointerId: number) => void;
      })
    | null;
  if (!target) return;
  try {
    if (on) target.setPointerCapture?.(e.pointerId);
    else target.releasePointerCapture?.(e.pointerId);
  } catch {
    // El puntero ya se soltó (o el navegador canceló el gesto): no es fatal.
  }
}

export default function ThermoProduct({
  product,
  bodyColor,
  finish,
  rotationDeg,
  scalePct,
  mirror,
  offsetYPct,
  invert,
  asset,
  onDrag,
  onDragStateChange,
  fade,
}: ThermoProductProps) {
  const spec = product.thermo;
  const isSystem = spec.geometry === 'system';
  const isBottle = spec.geometry === 'bowling';
  const surface = useMemo(() => thermoSurface(spec), [spec]);
  const bodyGeo = useMemo(() => buildThermoBodyGeometry(spec), [spec]);
  const baseGeo = useMemo(
    () => (isBottle ? null : buildThermoBaseGeometry(spec)),
    [isBottle, spec],
  );
  const collarGeo = useMemo(
    () => (isSystem ? null : buildThermoCollarGeometry(spec)),
    [isSystem, spec],
  );
  const lidGeo = useMemo(() => buildThermoLidGeometry(spec), [spec]);
  const handleGeo = useMemo(
    () => (isBottle ? null : buildThermoHandleGeometry(spec)),
    [isBottle, spec],
  );
  const grooveGeo = useMemo(
    () => (spec.geometry === 'media-manija' ? buildThermoGrooveGeometry(spec) : null),
    [spec],
  );
  const seamGeo = useMemo(
    () => (isSystem ? buildThermoSeamGeometry(spec) : null),
    [isSystem, spec],
  );
  const engraveGeo = useMemo(() => buildThermoEngravingGeometry(spec), [spec]);

  const systemHandle = useMemo(() => {
    if (!isSystem) return null;
    const up = new THREE.Vector3(0, 1, 0);
    const links = thermoHandleLinks(spec).map((l) => {
      const start = new THREE.Vector3(l.xMm, l.y1Mm, l.z1Mm);
      const end = new THREE.Vector3(l.xMm, l.y2Mm, l.z2Mm);
      const dir = end.clone().sub(start);
      const mid = start.clone().addScaledVector(dir, 0.5);
      return {
        mid,
        quaternion: new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()),
        lengthMm: dir.length(),
        radiusMm: l.radiusMm,
      };
    });
    return { mounts: thermoHandleMounts(spec), links };
  }, [isSystem, spec]);

  const pbr = useMemo(() => thermoBodyPbr(finish, bodyColor), [finish, bodyColor]);
  const burn = useMemo(() => thermoLaserBurn(bodyColor), [bodyColor]);

  const { canvas, heightCanvas, texture, heightTexture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = ENGRAVING_WIDTH_PX;
    c.height = thermoCanvasHeight(spec, ENGRAVING_WIDTH_PX);
    const h = document.createElement('canvas');
    h.width = c.width;
    h.height = c.height;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const hTex = new THREE.CanvasTexture(h);
    hTex.colorSpace = THREE.NoColorSpace;
    return { canvas: c, heightCanvas: h, texture: tex, heightTexture: hTex };
  }, [spec]);

  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const max = gl.capabilities.getMaxAnisotropy();
    texture.anisotropy = max;
    heightTexture.anisotropy = max;
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [texture, heightTexture, gl]);

  const fadeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    composeThermoEngravingCanvas(
      canvas,
      asset,
      {
        rotationDeg,
        scalePct,
        mirror,
        offsetYPct,
        invert,
      },
      spec,
      burn,
    );
    // Crossfade del visor: la capa saliente se compone aparte y se pinta encima
    // con alpha, sin tocar malla ni materiales (mismo contrato que el mate).
    if (fade && fade.asset && fade.alpha > 0.001) {
      let layer = fadeCanvasRef.current;
      if (!layer) {
        layer = document.createElement('canvas');
        fadeCanvasRef.current = layer;
      }
      if (layer.width !== canvas.width || layer.height !== canvas.height) {
        layer.width = canvas.width;
        layer.height = canvas.height;
      }
      composeThermoEngravingCanvas(
        layer,
        fade.asset,
        {
          rotationDeg: fade.rotationDeg,
          scalePct: fade.scalePct,
          mirror: fade.mirror,
          offsetYPct,
          invert,
        },
        spec,
        burn,
      );
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.globalAlpha = Math.max(0, Math.min(1, fade.alpha));
        ctx.drawImage(layer, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    composeEngravingHeightCanvas(heightCanvas, canvas);
    texture.needsUpdate = true;
    heightTexture.needsUpdate = true;
  }, [
    canvas,
    heightCanvas,
    texture,
    heightTexture,
    asset,
    rotationDeg,
    scalePct,
    mirror,
    offsetYPct,
    invert,
    spec,
    burn,
    fade,
  ]);

  const engraveMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        bumpMap: heightTexture,
        bumpScale: -0.018,
        transparent: true,
        depthWrite: false,
        metalness: 0.72,
        roughness: 0.34,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [texture, heightTexture],
  );
  useEffect(() => {
    engraveMaterial.opacity = burn.opacity;
    engraveMaterial.needsUpdate = true;
  }, [engraveMaterial, burn.opacity]);
  /* Al cambiar de familia el termo se desmonta: liberar texturas/material del
   * contexto WebGL compartido (las geometrías son cacheadas y se reusan). */
  useEffect(
    () => () => {
      engraveMaterial.dispose();
      texture.dispose();
      heightTexture.dispose();
    },
    [engraveMaterial, texture, heightTexture],
  );

  const dragRef = useRef<{
    angleOffset: number;
    yOffset: number;
    lastRotation: number;
  } | null>(null);

  const aspect = useMemo(() => thermoAssetAspect(asset), [asset]);
  const designSize = useMemo(
    () => thermoDesignSizeMm(spec, aspect, scalePct),
    [spec, aspect, scalePct],
  );
  const slackY = Math.max(0, (surface.heightMm - designSize.heightMm) / 2);
  /* Centro REALMENTE visible: el compositor clampa el ángulo al arco libre.
   * El arrastre debe arrancar desde ahí, no desde un valor viejo fuera de
   * rango (si no, el grabado salta al primer movimiento). */
  const centerAngle = useMemo(
    () => clampThermoRotation(spec, rotationDeg, scalePct, aspect),
    [spec, rotationDeg, scalePct, aspect],
  );

  function localPoint(e: ThreeEvent<PointerEvent>): THREE.Vector3 {
    return e.object.worldToLocal(e.point.clone());
  }

  function hitAngle(local: THREE.Vector3): number {
    const deg = (Math.atan2(local.x, local.z) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  function handleDown(e: ThreeEvent<PointerEvent>) {
    /* Sin diseño no hay nada que mover: dejar que la órbita siga funcionando. */
    if (!onDrag || !asset) return;
    e.stopPropagation();
    // Captura del puntero: el arrastre sigue aunque el dedo salga del cuerpo.
    capturePointer(e, true);
    const local = localPoint(e);
    const angle = hitAngle(local);
    const centerY = surface.centerYMm + (normalizeThermoOffset(offsetYPct) / 100) * slackY;
    dragRef.current = {
      angleOffset: angle - centerAngle,
      yOffset: local.y - centerY,
      lastRotation: centerAngle,
    };
    onDragStateChange?.(true);
  }

  function handleMove(e: ThreeEvent<PointerEvent>) {
    if (!onDrag || !dragRef.current) return;
    e.stopPropagation();
    const local = localPoint(e);
    const rawRotation = hitAngle(local) - dragRef.current.angleOffset;
    // Cruce de la costura 0/360: conservar el representante cercano al último.
    let rotation = rawRotation;
    while (rotation - dragRef.current.lastRotation > 180) rotation -= 360;
    while (rotation - dragRef.current.lastRotation < -180) rotation += 360;
    dragRef.current.lastRotation = rotation;
    const centerY = local.y - dragRef.current.yOffset;
    const offset =
      slackY > 0.001
        ? Math.max(-100, Math.min(100, ((centerY - surface.centerYMm) / slackY) * 100))
        : 0;
    onDrag({
      rotationDeg: ((rotation % 360) + 360) % 360,
      offsetYPct: normalizeThermoOffset(offset),
    });
  }

  function handleUp(e?: ThreeEvent<PointerEvent>) {
    if (!dragRef.current) return;
    e?.stopPropagation();
    if (e) capturePointer(e, false);
    dragRef.current = null;
    onDragStateChange?.(false);
  }

  return (
    <group>
      {/* Cuerpo pintado */}
      <mesh
        geometry={bodyGeo}
        castShadow
        receiveShadow
        onPointerDown={onDrag ? handleDown : undefined}
        onPointerMove={onDrag ? handleMove : undefined}
        onPointerUp={onDrag ? handleUp : undefined}
        onPointerLeave={onDrag ? handleUp : undefined}
        onPointerCancel={onDrag ? handleUp : undefined}
      >
        <meshStandardMaterial
          color={pbr.color}
          metalness={pbr.metalness}
          roughness={pbr.roughness}
        />
      </mesh>

      {/* Zócalo de acero (los termos; la botella lo integra al cuerpo) */}
      {!isBottle && baseGeo && (
        <mesh geometry={baseGeo} castShadow receiveShadow>
          <SteelMaterial />
        </mesh>
      )}

      {/* Collarín negro (Media Manija) o aro de silicona (Botella) */}
      {!isSystem && collarGeo && (
        <mesh geometry={collarGeo} castShadow receiveShadow>
          {isBottle ? <SiliconeMaterial /> : <CollarMaterial />}
        </mesh>
      )}
      {!isSystem &&
        grooveGeo &&
        [-1.26, 0, 1.26].map((dy) => (
          <mesh
            key={dy}
            geometry={grooveGeo}
            position={[0, spec.collarBottomMm + 7.56 + dy, 0]}
            rotation={[Math.PI / 2, 0, -Math.PI * 0.72]}
          >
            <meshStandardMaterial color="#0B0C0E" roughness={0.7} />
          </mesh>
        ))}

      {/* Tapa-vaso de acero */}
      <mesh geometry={lidGeo} castShadow receiveShadow>
        <SteelMaterial />
      </mesh>

      {/* Junta tapa-vaso/cuerpo (System: sin collarín) */}
      {isSystem && seamGeo && (
        <mesh geometry={seamGeo} position={[0, spec.lidBottomMm, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <CollarMaterial />
        </mesh>
      )}

      {/* Manija lateral (los termos; la botella no tiene) */}
      {!isBottle && handleGeo && (
        <group rotation={[0, spec.handleAngleRad, 0]}>
          <mesh geometry={handleGeo} castShadow receiveShadow>
            <CollarMaterial />
          </mesh>

        {/* Media Manija: perilla frontal */}
        {!isSystem && (
          <mesh
            position={[0, spec.collarBottomMm + 7.2, spec.radiusMm - 0.015 * 36]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.11 * 36, 0.11 * 36, 0.24 * 36, 24]} />
            <CollarMaterial />
          </mesh>
        )}

        {/* System: soportes y barras metálicas de la manija táctica */}
        {systemHandle &&
          systemHandle.mounts.map((m, i) => (
            <mesh key={`mount-${i}`} position={[0, m.yMm, m.zMm]} castShadow receiveShadow>
              <boxGeometry args={m.sizeMm} />
              <CollarMaterial />
            </mesh>
          ))}
          {systemHandle &&
            systemHandle.links.map((l, i) => (
              <mesh key={`link-${i}`} position={l.mid} quaternion={l.quaternion} castShadow>
                <cylinderGeometry args={[l.radiusMm, l.radiusMm, l.lengthMm, 16]} />
                <SteelMaterial />
              </mesh>
            ))}
        </group>
      )}

      {/* Grabado lateral (cilindro transparente) */}
      {asset && (
        <mesh
          geometry={engraveGeo}
          material={engraveMaterial}
          position={[0, surface.centerYMm, 0]}
          renderOrder={1}
        />
      )}
    </group>
  );
}
