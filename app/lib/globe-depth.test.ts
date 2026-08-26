import { describe, expect, it } from 'vitest';

import { ALTITUDE_SHELLS, EARTH_RADIUS_KM, shellRadius, subsolarPoint } from './globe-depth';

describe('subsolar point', () => {
  it('places the Sun over the tropics and never outside them', () => {
    for (const iso of [
      '2026-03-20T12:00:00Z',
      '2026-06-21T12:00:00Z',
      '2026-09-23T12:00:00Z',
      '2026-12-21T12:00:00Z',
    ]) {
      const point = subsolarPoint(new Date(iso))!;
      expect(point).not.toBeNull();
      expect(Math.abs(point.lat)).toBeLessThanOrEqual(23.5);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThanOrEqual(180);
    }
  });

  it('puts the Sun north of the equator at the June solstice and south at December', () => {
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z'))!.lat).toBeGreaterThan(23);
    expect(subsolarPoint(new Date('2026-12-21T12:00:00Z'))!.lat).toBeLessThan(-23);
  });

  it('sweeps the subsolar longitude westward at roughly fifteen degrees an hour', () => {
    const start = subsolarPoint(new Date('2026-08-26T00:00:00Z'))!;
    const later = subsolarPoint(new Date('2026-08-26T06:00:00Z'))!;
    let travelled = start.lng - later.lng;
    if (travelled < 0) travelled += 360;
    expect(travelled).toBeGreaterThan(88);
    expect(travelled).toBeLessThan(92);
  });

  it('rejects an invalid date', () => {
    expect(subsolarPoint(new Date('nonsense'))).toBeNull();
  });
});

describe('altitude shells', () => {
  it('scales each shell above the globe surface in proportion to its altitude', () => {
    const globeRadius = 100;
    for (const shell of ALTITUDE_SHELLS) {
      const radius = shellRadius(globeRadius, shell.altitudeKm);
      expect(radius).toBeGreaterThan(globeRadius);
      expect(radius).toBeCloseTo(globeRadius * (1 + shell.altitudeKm / EARTH_RADIUS_KM), 6);
    }
  });

  it('keeps the shells ordered and distinct', () => {
    const radii = ALTITUDE_SHELLS.map((shell) => shellRadius(100, shell.altitudeKm));
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(new Set(radii).size).toBe(radii.length);
  });
});
