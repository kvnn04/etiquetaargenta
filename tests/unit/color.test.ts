import { describe, expect, it } from 'vitest';
import {
  METAL_PRESETS,
  BODY_PRESETS,
  FREE_BODY_PBR,
  ANODIZED_VIROLA_PBR,
  resolveVirolaPbr,
  resolveBodyPbr,
  relativeLuminance,
  adaptiveLaserBurn,
  formatColorDescriptor,
  normalizeHex,
} from '@/lib/color';

/* ============================================================================
 * R1 — Tabla PBR canónica
 * ========================================================================== */

describe('R1 — Tabla PBR canónica', () => {
  describe('METAL_PRESETS', () => {
    it('alpaca tiene los parámetros PBR correctos', () => {
      expect(METAL_PRESETS.alpaca.pbr).toEqual({
        color: '#D8DADC',
        metalness: 0.9,
        roughness: 0.28,
      });
    });

    it('acero tiene los parámetros PBR correctos', () => {
      expect(METAL_PRESETS.acero.pbr).toEqual({
        color: '#A9ABAD',
        metalness: 0.85,
        roughness: 0.55,
      });
    });

    it('bronce tiene los parámetros PBR correctos', () => {
      expect(METAL_PRESETS.bronce.pbr).toEqual({
        color: '#B08344',
        metalness: 0.95,
        roughness: 0.35,
      });
    });
  });

  describe('BODY_PRESETS', () => {
    it('algarrobo tiene los parámetros PBR correctos', () => {
      expect(BODY_PRESETS.algarrobo.pbr).toEqual({
        color: '#5A3825',
        metalness: 0.0,
        roughness: 0.72,
      });
    });

    it('calabaza tiene los parámetros PBR correctos', () => {
      expect(BODY_PRESETS.calabaza.pbr).toEqual({
        color: '#A45D2B',
        metalness: 0.0,
        roughness: 0.78,
      });
    });

    it('cuero_negro tiene los parámetros PBR correctos', () => {
      expect(BODY_PRESETS.cuero_negro.pbr).toEqual({
        color: '#171311',
        metalness: 0.0,
        roughness: 0.62,
      });
    });
  });

  it('FREE_BODY_PBR tiene los valores correctos', () => {
    expect(FREE_BODY_PBR).toEqual({ metalness: 0.0, roughness: 0.82 });
  });

  it('ANODIZED_VIROLA_PBR tiene los valores correctos', () => {
    expect(ANODIZED_VIROLA_PBR).toEqual({ metalness: 0.1, roughness: 0.45 });
  });
});

/* ============================================================================
 * R3 — Exclusividad mutua preset vs custom
 * ========================================================================== */

describe('R3 — Exclusividad mutua preset vs custom', () => {
  describe('resolveVirolaPbr', () => {
    it('sin color custom usa el preset alpaca', () => {
      expect(resolveVirolaPbr('alpaca', null)).toEqual(METAL_PRESETS.alpaca.pbr);
    });

    it('con color custom ignora el preset y aplica anodizado libre', () => {
      expect(resolveVirolaPbr('alpaca', '#FF0000')).toEqual({
        color: '#FF0000',
        metalness: 0.1,
        roughness: 0.45,
      });
    });

    it('preset bronce es ignorado cuando hay color hex personalizado', () => {
      expect(resolveVirolaPbr('bronce', '#FF0000')).toEqual({
        color: '#FF0000',
        metalness: 0.1,
        roughness: 0.45,
      });
    });
  });

  describe('resolveBodyPbr', () => {
    it('sin color custom usa el preset algarrobo', () => {
      expect(resolveBodyPbr('algarrobo', null)).toEqual(BODY_PRESETS.algarrobo.pbr);
    });

    it('con color custom ignora el preset y aplica color libre', () => {
      expect(resolveBodyPbr('algarrobo', '#FF0000')).toEqual({
        color: '#FF0000',
        metalness: 0.0,
        roughness: 0.82,
      });
    });
  });
});

/* ============================================================================
 * R4 — Luminancia y quemado adaptativo determinista
 * ========================================================================== */

describe('R4 — Luminancia y quemado adaptativo', () => {
  describe('relativeLuminance', () => {
    it('blanco (#FFFFFF) tiene luminancia ≈ 1.0', () => {
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1.0, 3);
    });

    it('negro (#000000) tiene luminancia ≈ 0.0', () => {
      expect(relativeLuminance('#000000')).toBeCloseTo(0.0, 3);
    });

    it('gris claro (#8E8E8E) tiene luminancia ≥ 0.55', () => {
      // 0x8E/255 → L ≈ 0.557, superando el umbral de 0.55
      expect(relativeLuminance('#8E8E8E')).toBeGreaterThanOrEqual(0.55);
    });
  });

  describe('adaptiveLaserBurn', () => {
    it('null (preset metálico) → siempre modo dark', () => {
      expect(adaptiveLaserBurn(null).mode).toBe('dark');
    });

    it('blanco (#FFFFFF, L=1 ≥ 0.55) → modo dark', () => {
      expect(adaptiveLaserBurn('#FFFFFF').mode).toBe('dark');
    });

    it('negro (#000000, L=0 < 0.55) → modo silver', () => {
      expect(adaptiveLaserBurn('#000000').mode).toBe('silver');
    });

    it('blanco → color quemado oscuro #2B2118', () => {
      expect(adaptiveLaserBurn('#FFFFFF').color).toBe('#2B2118');
    });

    it('negro → color plateado #C9CCCF', () => {
      expect(adaptiveLaserBurn('#000000').color).toBe('#C9CCCF');
    });
  });
});

/* ============================================================================
 * R5 — Descriptores canónicos de Ficha
 * ========================================================================== */

describe('R5 — Descriptores canónicos de Ficha', () => {
  it('virola preset alpaca sin custom → "Virola: Alpaca / Plata"', () => {
    expect(formatColorDescriptor('virola', 'alpaca', null)).toBe('Virola: Alpaca / Plata');
  });

  it('virola alpaca con custom hex → descriptor anodizado personalizado', () => {
    expect(formatColorDescriptor('virola', 'alpaca', '#2A2A2A')).toBe(
      'Virola: #2A2A2A · Anodizado Personalizado',
    );
  });

  it('body preset algarrobo sin custom → "Cuerpo: Algarrobo / Madera"', () => {
    expect(formatColorDescriptor('body', 'algarrobo', null)).toBe('Cuerpo: Algarrobo / Madera');
  });

  it('body algarrobo con custom hex → descriptor color libre', () => {
    expect(formatColorDescriptor('body', 'algarrobo', '#E6C48E')).toBe(
      'Cuerpo: #E6C48E · Color Libre',
    );
  });
});

/* ============================================================================
 * R6 — Normalización HEX
 * ========================================================================== */

describe('R6 — Normalización HEX', () => {
  it('hex válido con # en mayúsculas → retorna tal cual', () => {
    expect(normalizeHex('#FF5500')).toBe('#FF5500');
  });

  it('hex sin # → se agrega el prefijo y se convierte a mayúsculas', () => {
    expect(normalizeHex('ff5500')).toBe('#FF5500');
  });

  it('hex de 3 dígitos → se expande a 6 dígitos', () => {
    expect(normalizeHex('#F53')).toBe('#FF5533');
  });

  it('string inválido → retorna null', () => {
    expect(normalizeHex('xyz')).toBeNull();
  });

  it('null → retorna null', () => {
    expect(normalizeHex(null)).toBeNull();
  });

  it('número → retorna null', () => {
    expect(normalizeHex(123)).toBeNull();
  });

  it('hex en minúsculas con # → se convierte a mayúsculas', () => {
    expect(normalizeHex('#ff5500')).toBe('#FF5500');
  });
});
