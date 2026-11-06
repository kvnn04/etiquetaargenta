/* ============================================================================
 * TESTS POSICIÓN 9 — textos de la Ficha (ÚNICA FUENTE:
 * spec_detalle_del_modelo_en_ficha.md): R5 (observaciones ≤ 280 imprimibles
 * en ≤ 2 líneas con truncado elegante a `…` preservando palabras enteras) y
 * §5 (nomenclatura de archivos `{taller}-ficha-mate-{model}-{aaaammdd}.png|pdf`
 * / `{taller}-foto-mate-{model}-{aaaammdd}.png`).
 * Todo módulo tests es PURO: la medición se inyecta (measure sintética).
 * ============================================================================ */

import { describe, expect, it } from 'vitest';
import {
  OBSERVACIONES_MAX,
  fichaFileName,
  formatFileDate,
  fotoFileName,
  hasObservaciones,
  observationsWords,
  slugTaller,
  wrapObservations,
} from '@/lib/quote/texts';

/** Medición sintética determinista: 10 por carácter (palabra de N chars). */
const measure10 = (s: string): number => s.length * 10;

/** t0: 03-nov-2026 12:00 LOCAL (500673…) — formatFileDate usa el reloj local
 *  del archivo (aaaammdd); mediodía local evita cualquier borde de DST. */
const T0 = new Date(2026, 10, 3, 12, 0, 0).getTime();

describe('R5 — observaciones: campo acotado + bloque opcional', () => {
  it('la cota EXACTA del campo libre es 280', () => {
    expect(OBSERVACIONES_MAX).toBe(280);
  });

  it('parte en palabras respetando espacios (jamás corta a mitad)', () => {
    expect(observationsWords('Nombre, frase o  pedido')).toEqual([
      'Nombre,',
      'frase',
      'o',
      'pedido',
    ]);
    expect(observationsWords('   ')).toEqual([]);
  });

  it('hasObservaciones: sin texto ⇒ sin bloque', () => {
    expect(hasObservaciones('')).toBe(false);
    expect(hasObservaciones('   ')).toBe(false);
    expect(hasObservaciones(null)).toBe(false);
    expect(hasObservaciones('Con vos')).toBe(true);
  });
});

describe('R5 — wrapObservations: ≤ 2 líneas con `…` preservando palabras', () => {
  it('el texto que entra entero queda SIN elipsis (cortes solo por ancho)', () => {
    // 'hola mundo' mide 100 > 60 ⇒ 2 líneas, pero ≤ maxLines ⇒ SIN elipsis.
    expect(wrapObservations('hola mundo', 60, measure10)).toEqual(['hola', 'mundo']);
  });

  it('se corta por palabras enteras cuando excede el ancho', () => {
    expect(wrapObservations('hola mundo', 60, measure10, 3)).toEqual(['hola', 'mundo']);
  });

  it('textos largos se recortan a máx 2 líneas SIEMPRE (R5)', () => {
    const text = 'aa bb cc dd ee ff';
    // 'aa bb'(50) y 'cc dd'(50) caben justo; el resto se trunca con `…`.
    const lines = wrapObservations(text, 50, measure10, 2);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('aa bb');
    expect(lines[1]!.startsWith('cc')).toBe(true);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });

  it('la última línea con elipsis PRESERVA la palabra entera (jamás mitades)', () => {
    // Con presupuesto excedente el `…` acompaña a la palabra entera previa.
    expect(wrapObservations('hola mundo todo bien', 60, measure10, 2)).toEqual([
      'hola',
      'mundo…',
    ]);
  });

  it('texto vacío/solo espacios ⇒ lista vacía', () => {
    expect(wrapObservations('', 100, measure10)).toEqual([]);
    expect(wrapObservations('     ', 100, measure10)).toEqual([]);
  });

  it('palabra más larga que la línea: queda ENTERA (el lienzo recorta el glifo)', () => {
    // Sigue texto detrás ('x') ⇒ hay truncado real ⇒ `…` cierra la palabra entera.
    expect(wrapObservations('supercalifragilístico x', 20, measure10, 1)).toEqual([
      'supercalifragilístico…',
    ]);
    // Es la ÚNICA palabra del texto ⇒ nada que truncar ⇒ SIN elipsis.
    expect(wrapObservations('supercalifragilístico', 20, measure10, 1)).toEqual(['supercalifragilístico']);
  });
});

describe('§5 — nomenclatura de archivos', () => {
  it('slugTaller: minúsculas, sin acentos, símbolos ⇒ `-`', () => {
    expect(slugTaller('Etiqueta Argenta')).toBe('etiqueta-argenta');
    expect(slugTaller('Taller Ñandú!')).toBe('taller-nandu');
    expect(slugTaller('Etiqueta Argenta 3D')).toBe('etiqueta-argenta-3d');
  });

  it('slugTaller: vacío/inutilizable ⇒ `taller` (el archivo SIEMPRE tiene nombre)', () => {
    expect(slugTaller('')).toBe('taller');
    expect(slugTaller('///')).toBe('taller');
    expect(slugTaller(null)).toBe('taller');
  });

  it('slugTaller: recorte a 40 sin guion colgante', () => {
    const long = 'taller de mates impresionantemente largo con muchas palabras seguidas';
    const slug = slugTaller(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('taller-de-mates')).toBe(true);
  });

  it('formatFileDate: aaaammdd determinista', () => {
    expect(formatFileDate(T0)).toBe('20261103');
  });

  it('fichaFileName EXACTO (ejemplo de la spec §5)', () => {
    expect(
      fichaFileName({ tallerTitle: 'Etiqueta Argenta', modelId: 'imperial', capturedAtMs: T0, kind: 'png' }),
    ).toBe('etiqueta-argenta-ficha-mate-imperial-20261103.png');
    expect(
      fichaFileName({ tallerTitle: 'Etiqueta Argenta', modelId: 'imperial', capturedAtMs: T0, kind: 'pdf' }),
    ).toBe('etiqueta-argenta-ficha-mate-imperial-20261103.pdf');
  });

  it('fotoFileName replica el patrón §5', () => {
    expect(
      fotoFileName({ tallerTitle: 'Etiqueta Argenta', modelId: 'imperial', capturedAtMs: T0 }),
    ).toBe('etiqueta-argenta-foto-mate-imperial-20261103.png');
  });

  it('id de modelo sanitizado para el archivo (quedan [a-z0-9-] o camionero)', () => {
    expect(
      fichaFileName({ tallerTitle: 'Mi Taller', modelId: 'IMPERIAL!', capturedAtMs: T0, kind: 'png' }),
    ).toBe('mi-taller-ficha-mate-imperial-20261103.png');
    expect(
      fichaFileName({ tallerTitle: 'Mi Taller', modelId: '***', capturedAtMs: T0, kind: 'png' }),
    ).toBe('mi-taller-ficha-mate-camionero-20261103.png');
  });
});
