import { describe, expect, it } from 'vitest';

import { parseOptionalNumber, parseSocratesCsv } from './server-data';

describe('SOCRATES source normalization', () => {
  it('keeps blank numeric fields missing instead of converting them to zero', () => {
    expect(parseOptionalNumber('')).toBeNull();
    expect(parseOptionalNumber('   ')).toBeNull();
    expect(parseOptionalNumber(null)).toBeNull();
    expect(parseOptionalNumber('0')).toBe(0);
  });

  it('marks a row with blank maximum probability as needing data', () => {
    const csv = [
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION',
      '44804,CARTOSAT-3,1.2,42901,VENUS,1.1,2026-08-27 12:00:00,1.6,3.5,,0.4',
    ].join('\n');
    const [event] = parseSocratesCsv(csv, new Date('2026-08-25T00:00:00Z'));
    expect(event.maximumProbability).toBeNull();
    expect(event.priority).toBe('needs-data');
  });
});
