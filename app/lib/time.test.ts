import { describe, expect, it } from 'vitest';

import { advanceSimulationTime, formatIst } from './time';

describe('formatIst', () => {
  it('converts UTC timestamps to India Standard Time', () => {
    expect(formatIst('2026-08-25T00:00:00.000Z', { seconds: true, year: true }))
      .toBe('25 Aug 2026, 05:30:00 IST');
  });

  it('marks missing values as unavailable', () => {
    expect(formatIst(null)).toBe('Unavailable');
  });

  it('advances simulation time at 10x and 60x', () => {
    expect(advanceSimulationTime(1_000, 100, 10)).toBe(2_000);
    expect(advanceSimulationTime(1_000, 100, 60)).toBe(7_000);
  });
});
