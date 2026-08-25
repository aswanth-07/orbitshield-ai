import { describe, expect, it } from 'vitest';

import { PUBLIC_TRIAGE_MODEL, scorePublicConjunction } from './public-triage';
import type { ConjunctionRecord } from './types';

const event: ConjunctionRecord = {
  id: '43111-53076-2026-08-26T12:47:54.108Z',
  primaryCatalogId: 43111,
  primaryName: 'CARTOSAT-2F [+]',
  primaryElementAgeDays: 3.9,
  secondaryCatalogId: 53076,
  secondaryName: 'STARLINK-4347 [+]',
  secondaryElementAgeDays: 3.8,
  tca: '2026-08-26T12:47:54.108Z',
  rangeKm: 2.326,
  relativeSpeedKmS: 12.79,
  maximumProbability: 1.5e-5,
  dilutionKm: 1.1,
  priority: 'watch',
  reasons: [],
  flags: [],
};

describe('public feed triage', () => {
  it('scores a complete current event inside the trained two-day horizon', () => {
    const result = scorePublicConjunction(event, Date.parse('2026-08-25T05:30:00Z'));
    expect(result).not.toBeNull();
    expect(result?.inputCoverage).toBe(1);
    expect(result?.score).toBeCloseTo(0.8823617683416393, 12);
    expect(result?.score).toBeGreaterThanOrEqual(PUBLIC_TRIAGE_MODEL.scoreThreshold);
    expect(result?.triage).toBe('elevated');
  });

  it('does not score past, distant, or incomplete events', () => {
    expect(scorePublicConjunction(event, Date.parse('2026-08-27T05:30:00Z'))).toBeNull();
    expect(scorePublicConjunction(event, Date.parse('2026-08-23T05:30:00Z'))).toBeNull();
    expect(scorePublicConjunction({ ...event, maximumProbability: null }, Date.parse('2026-08-25T05:30:00Z'))).toBeNull();
  });
});
