import { describe, expect, it } from 'vitest';

import {
  eventForSatellite, eventTouchesMonitoringList, highestFleetDebrisAlert,
  isFutureConjunction, monitoredState, normalizeMonitoringIds, publicFeedPresentation,
} from './monitoring';
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
    expect(monitoredState(null, false)).toEqual({ label: 'Connector needed', tone: 'needs-data' });
  });

  it('filters conjunctions against the editable monitoring list', () => {
    expect(eventTouchesMonitoringList(event({ primaryCatalogId: 10, secondaryCatalogId: 20 }), new Set([20]))).toBe(true);
    expect(eventTouchesMonitoringList(event({ primaryCatalogId: 10, secondaryCatalogId: 20 }), [30])).toBe(false);
  });

  it('normalizes persisted catalogue ids without duplicates or invalid values', () => {
    expect(normalizeMonitoringIds(['44804', 44804, -1, 'bad', 54361], 6)).toEqual([44804, 54361]);
  });

  it('keeps past conjunctions out of the active queue', () => {
    const record = event({ tca: '2026-08-25T00:00:00.000Z' });
    expect(isFutureConjunction(record, new Date('2026-08-24T23:59:59.000Z').getTime())).toBe(true);
    expect(isFutureConjunction(record, new Date('2026-08-25T00:00:01.000Z').getTime())).toBe(false);
  });

  it('distinguishes a current run from an honest latest-available fallback', () => {
    expect(publicFeedPresentation('current', false, false)).toEqual({ tone: 'current', label: 'CURRENT SOCRATES RUN' });
    expect(publicFeedPresentation('cached', false, false)).toEqual({ tone: 'cached', label: 'LATEST AVAILABLE PUBLIC DATA' });
    expect(publicFeedPresentation('cached', false, false, 'CelesTrak SOCRATES current run')).toEqual({ tone: 'current', label: 'SYNCED SOCRATES RUN' });
    expect(publicFeedPresentation('current', true, false)).toEqual({ tone: 'refreshing', label: 'UPDATING PUBLIC FEED' });
  });
});
