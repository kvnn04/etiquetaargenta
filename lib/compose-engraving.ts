/* ============================================================================
 * COMPOSITOR CANÓNICO DEL GRABADO — ÚNICA FUENTE compartida por
 * spec_rotacion_archivo_svg_png.md + spec_escala_y_alerta_de_desborde.md
 * (posiciones 6–7) y reusado por la Ficha HD (spec_detalle_del_modelo_en_-
 * ficha.md R6/R8: re-proyección a ≥2048²).
 * ----------------------------------------------------------------------------
 * · Marco canónico R1: el canvas proyecta UV polar centrada x/(2R)+0.5
 *   (lathe-builder) ⇒ px = C+x·s / py = C−z·s con flipY del texture: el +Z
 *   (Frente con la cámara por defecto) es el borde SUPERIOR del canvas y por
 *   eso rotate(+θ) en canvas ≡ rotateY(+θ) en mundo ≡ giro visual horario:
 *   0° Frente / 90° Der / 180° Dorso / 270° Izq (presets EXACTOS de la R4).
 *   La costura lathe (ancla de guías pos 4) queda al DORSO — nota visual
 *   anotada: 0° del DISEÑO es el frente del canvas.
 * · R2 (pos 7 = spec_escala): pipeline canónico ESCALA → ESPEJO → ROTACIÓN
 *   compositadas AL MISMO PIVOTE (centro del carril = origen 50%/50%).
 * · R1 (pos 7): el ANCLAJE del 100 % ya vive en el ráster (contain-fit R8 de
 *   pos 6 = envolvente tocando el anillo); el asset congela su base en mm
 *   (baseSideMm) y el % multiplica SOLO esa base — editar D_ext/D_int después
 *   NO re-escala el diseño, solo re-chequea.
 * · R8: la escena llama con su canvas de trabajo 1024²; la Ficha HD llama con
 *   ≥2048² para la re-proyección de export — MISMA función (un solo motor).
 * · Clipping anular con máscara destination-in SOLO entre R_int y R_ext, y
 *   tinte ÚNICO con el tono del quemado adaptativo R4 (pos 5).
 * ============================================================================ */

/**
 * Compone el grabado en `canvas` a tamaño arbitrario (R8: trabajo vivo
 * 1024² en la escena; Ficha HD re-proyecta a ≥2048²).
 *
 * @param asset ráster de trabajo del diseño (1024²) o null ⇒ canvas limpio
 * @param rotationDeg ángulo canónico [0°, 360°) paso 0.5° (R3)
 * @param mirror espejo horizontal (R2 pos 7)
 * @param scalePct escala en % [70, 110] (R8 pos 7) — multiplicador de la base
 * @param burn color del quemado adaptativo R4 pos 5 (dark/silver)
 * @param rInMm radio interior vigente (mm)
 * @param rOutMm radio exterior vigente (mm)
 */
export function composeEngravingCanvas(
  canvas: HTMLCanvasElement,
  asset: HTMLCanvasElement | null,
  rotationDeg: number,
  mirror: boolean,
  scalePct: number,
  burn: { color: string },
  rInMm: number,
  rOutMm: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const C = canvas.width / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!asset || rOutMm <= 0 || rInMm >= rOutMm) return;

  const pxPerMm = C / rOutMm; // UV polar: el borde del canvas ES R_ext
  void pxPerMm;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // R8: máxima interpolación del PNG/SVG

  // Pipeline canónico R2 sobre el PIVOTE (QA1: nunca se desliza). El orden de
  // llamadas canvas ES el orden canónico: la matriz resultante T·R·Escala·Espejo
  // aplica Escala primero, luego Espejo y por último Rotación — así la rotación
  // gira EXACTAMENTE la imagen que el usuario ve (QA2: espejo + 90°/270° siguen
  // en sentido visual horario).
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale(mirror ? -1 : 1, 1);
  ctx.scale(scalePct / 100, scalePct / 100);
  // Dibujo FULL-canvas del ráster de trabajo (R1: base congelada = el 100 %
  // deja la envolvente tocando el anillo — jamás inscrito en el hueco).
  // La Ficha HD compone sobre 2048² y el asset de sesión es 1024²: se escala
  // al canvas; sin esto el grabado quedaba en un cuadrante y la máscara
  // anular lo recortaba casi por completo.
  ctx.translate(-C, -C);
  ctx.drawImage(asset, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 2) Tinte ÚNICO con el tono de quemado (pos 5 R4 ⇒ grabado láser)
  //    monótono: conserva la silueta del trazado, no el color de origen.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = burn.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 3) Máscara anular: el grabado NO sale de la banda (R_int → R_ext).
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(C, C, C, 0, Math.PI * 2); // exterior = R_ext
  ctx.arc(C, C, (rInMm / rOutMm) * C, 0, Math.PI * 2, true); // agujero interior
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}
