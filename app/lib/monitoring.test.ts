import { describe, expect, it } from 'vitest';

import { eventForSatellite, highestFleetDebrisAlert, monitoredState } from './monitoring';
import type { ConjunctionRecord, ThreatObject } from './types';

function event(overrides: Partial<ConjunctionRecord>): ConjunctionRecord {
  return {
    id: '1-2-2026',
    primaryCatalogId: 1,
    primaryName: 'MONITORED',
    primaryElementAgeDays: 1,
    secondaryCatalogId: 2,
    secondaryName: 'COUNTERPART',
    secondaryElementAgeDays: 1,
    tca: '2026-08-25T00:00:00.000Z',
    rangeKm: 1,
    relativeSpeedKmS: 8,
    maximumProbability: 1e-6,
    dilutionKm: null,
    priority: 'watch',
    reasons: ['Watch threshold crossed.'],
    flags: [],
    ...overrides,
  };
}

function threat(catalogId: number, objectType: string): ThreatObject {
  return {
    catalogId,
    name: `OBJECT ${catalogId}`,
    objectType,
    owner: 'TEST',
    rcs: null,
    size: 'unknown',
    eventIds: [],
    protectedSatelliteIds: [],
    eventCount: 1,
    maximumProbability: null,
    minimumRangeKm: null,
    nextTca: null,
    record: null,
  };
}

describe('automated monitoring selection', () => {
  it('returns the highest-priority event for one monitored satellite', () => {
    const watch = event({ id: 'watch', priority: 'watch', maximumProbability: 1e-5 });
    const review = event({ id: 'review', secondaryCatalogId: 3, priority: 'review', maximumProbability: 1e-4 });
    expect(eventForSatellite([watch, review], 1)?.id).toBe('review');
  });

  it('prefers a debris alert for the automatic product view', () => {
    const satelliteReview = event({ id: 'satellite', secondaryCatalogId: 3, priority: 'review', maximumProbability: 2e-4 });
    const debrisWatch = event({ id: 'debris', secondaryCatalogId: 4, priority: 'watch', maximumProbability: 2e-5 });
    const threats = new Map([
      [3, threat(3, 'PAY')],
      [4, threat(4, 'DEB')],
    ]);
    expect(highestFleetDebrisAlert([satelliteReview, debrisWatch], [1], threats)?.id).toBe('debris');
  });

  it('prefers a named debris object over an unknown public object', () => {
    const unknown = event({ id: 'unknown', secondaryCatalogId: 4, priority: 'watch', maximumProbability: 5e-5 });
    const named = event({ id: 'named', secondaryCatalogId: 5, priority: 'watch', maximumProbability: 2e-5 });
    const threats = new Map([
      [4, { ...threat(4, 'UNK'), name: 'UNKNOWN' }],
      [5, { ...threat(5, 'DEB'), name: 'FENGYUN 1C DEB' }],
    ]);
    expect(highestFleetDebrisAlert([unknown, named], [1], threats)?.id).toBe('named');
  });

  it('shows a clear state when a monitored satellite has no event', () => {
    expect(monitoredState(null)).toEqual({ label: 'Clear', tone: 'clear' });
    expect(monitoredState(event({ priority: 'needs-data' }))).toEqual({ label: 'Needs data', tone: 'needs-data' });
  });
});
