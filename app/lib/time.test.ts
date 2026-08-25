import { describe, expect, it } from 'vitest';

import { formatIst } from './time';

describe('formatIst', () => {
  it('converts UTC timestamps to India Standard Time', () => {
    expect(formatIst('2026-08-25T00:00:00.000Z', { seconds: true, year: true }))
      .toBe('25 Aug 2026, 05:30:00 IST');
  });

  it('marks missing values as unavailable', () => {
    expect(formatIst(null)).toBe('Unavailable');
  });
});
