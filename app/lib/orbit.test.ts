import { describe, expect, it } from 'vitest';

import { propagateOmm, sampleClosedOrbitPath, sampleDynamicOrbitPath, sampleOrbitSegment } from './orbit';
import type { OmmRecord } from './types';

const record: OmmRecord = {
  OBJECT_NAME: 'TEST PAYLOAD',
  OBJECT_ID: '2024-001A',
  EPOCH: '2026-03-26T10:53:58.905600',
  MEAN_MOTION: 13.76519324,
  ECCENTRICITY: 0.002524,
  INCLINATION: 90.2177,
  RA_OF_ASC_NODE: 69.8332,
  ARG_OF_PERICENTER: 177.4991,
  MEAN_ANOMALY: 280.3186,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 900,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 6004,
  BSTAR: 0.00064393,
  MEAN_MOTION_DOT: 0.00000641,
  MEAN_MOTION_DDOT: 0,
  OBJECT_TYPE: 'PAYLOAD',
  COUNTRY_CODE: 'TST',
  LAUNCH_DATE: '2024-01-01',
};

describe('future orbit segment sampling', () => {
  it('keeps the visible ground track on the moving SGP4 marker frame', () => {
    const center = new Date('2026-03-26T10:53:58.905600Z');
    const marker = propagateOmm(record, center);
    const path = sampleDynamicOrbitPath(record, center, '#35d7ff', 11);

    expect(marker).not.toBeNull();
    expect(path.points[5].lat).toBeCloseTo(marker!.lat, 3);
    expect(path.points[5].lng).toBeCloseTo(marker!.lng, 3);
    expect(path.points[5].altitude).toBeCloseTo(marker!.altitude, 6);
  });

  it('builds an explicitly closed SGP4 orbit wire', () => {
    const center = new Date('2026-03-26T10:53:58.905600Z');
    const path = sampleClosedOrbitPath(record, center, '#35d7ff', 64);

    expect(path.points).toHaveLength(64);
    expect(path.points[0]).toEqual(path.points.at(-1));
    expect(path.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))).toBe(true);
  });

  it('starts at the displayed object time and ends exactly at TCA', () => {
    const start = new Date('2026-03-26T10:53:58.905600Z');
    const tca = new Date(start.getTime() + 20 * 60_000);
    const startPoint = propagateOmm(record, start);
    const tcaPoint = propagateOmm(record, tca);
    const path = sampleOrbitSegment(record, start, tca, '#ff4452', 16);

    expect(startPoint).not.toBeNull();
    expect(tcaPoint).not.toBeNull();
    expect(path.points).toHaveLength(16);
    expect(path.points[0]).toEqual({
      lat: startPoint?.lat,
      lng: startPoint?.lng,
      altitude: startPoint?.altitude,
    });
    expect(path.points.at(-1)).toEqual({
      lat: tcaPoint?.lat,
      lng: tcaPoint?.lng,
      altitude: tcaPoint?.altitude,
    });
  });

  it('uses a bundled TLE when it is fresher than the fallback OMM fields', () => {
    const tleRecord: OmmRecord = {
      ...record,
      NORAD_CAT_ID: 44804,
      OBJECT_NAME: 'CARTOSAT 3',
      EPOCH: '2026-08-24T14:08:57.153Z',
      TLE_LINE1: '1 44804U 19081A   26236.58955039  .00003527  00000-0  17043-3 0  9997',
      TLE_LINE2: '2 44804  97.4252 297.3328 0010320 275.4320  84.5737 15.19247219373855',
    };
    const point = propagateOmm(tleRecord, new Date(tleRecord.EPOCH));

    expect(point).not.toBeNull();
    expect(point?.catalogId).toBe(44804);
    expect(point?.altitudeKm).toBeGreaterThan(300);
    expect(point?.altitudeKm).toBeLessThan(1_000);
  });
});
