import { afterEach, describe, expect, it, vi } from 'vitest';

import snapshot from '../data/active-catalog.snapshot.json';
import { debrisSizeFromRcs, getCatalog, normalizeOmm, parseSocratesCsv } from './server-data';
import { propagateOmm } from './orbit';
import { propagateCatalogue } from '../workers/propagation.worker';
import type { OmmRecord } from './types';

describe('data normalization and propagation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects malformed OMM rows', () => {
    const records = normalizeOmm([{ OBJECT_NAME: 'bad' }, snapshot.objects[0]]);
    expect(records).toHaveLength(1);
    expect(Number(records[0].NORAD_CAT_ID)).toBeGreaterThan(0);
  });

  it('returns finite SGP4 globe coordinates in the worker contract', () => {
    const record = snapshot.objects.find((item) => Number(item.NORAD_CAT_ID) === 41877) as OmmRecord;
    const atEpoch = new Date(record.EPOCH);
    const point = propagateOmm(record, atEpoch);
    expect(point).not.toBeNull();
    expect(point!.lat).toBeGreaterThanOrEqual(-90);
    expect(point!.lat).toBeLessThanOrEqual(90);
    expect(point!.altitudeKm).toBeGreaterThan(100);
    expect(propagateCatalogue([record], atEpoch.getTime())).toHaveLength(1);
  });

  it('normalizes a fleet SOCRATES row and applies screening rules', () => {
    const csv = [
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION',
      '41877,RESOURCESAT-2A,2.1,270316,UNKNOWN,5.5,2026-08-25 23:28:03.240,0.47,14.819,0.000006898,0.321',
    ].join('\n');
    const [event] = parseSocratesCsv(csv, new Date('2026-08-24T00:00:00Z'));
    expect(event.priority).toBe('watch');
    expect(event.flags).toContain('close-range');
    expect(event.primaryCatalogId).toBe(41877);
  });

  it('maps published radar cross section into the official size bands', () => {
    expect(debrisSizeFromRcs(0.099)).toBe('small');
    expect(debrisSizeFromRcs(0.1)).toBe('medium');
    expect(debrisSizeFromRcs(1)).toBe('medium');
    expect(debrisSizeFromRcs(1.001)).toBe('large');
    expect(debrisSizeFromRcs(null)).toBe('unknown');
  });

  it('falls back to the bundled snapshot after one non-200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await getCatalog([41877]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe('cached');
    expect(response.objects).toHaveLength(1);
    expect(response.message).toContain('offline snapshot');
  });
});
