import { describe, expect, it } from 'vitest';

import fleetOrbitFixture from '../data/fleet-orbits.snapshot.json';
import { buildManeuverStudy, hcwImpulseDisplacement, leadTimeCostCurve, propellantForImpulse, sampleManeuverPath } from './maneuver';
import type { ConjunctionRecord, OmmRecord } from './types';

const orbitFixture = fleetOrbitFixture as {
  objects: Array<{ catalogId: number; epoch: string; tleLine1: string; tleLine2: string }>;
};

function protectedRecord(): OmmRecord {
  const fixture = orbitFixture.objects.find((item) => item.catalogId === 44804)!;
  return {
    OBJECT_NAME: 'CARTOSAT-3', OBJECT_ID: '2019-081A', EPOCH: fixture.epoch,
    MEAN_MOTION: 15.2, ECCENTRICITY: 0.001, INCLINATION: 97.5,
    RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0,
    NORAD_CAT_ID: 44804, ELEMENT_SET_NO: 1, BSTAR: 0,
    MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    TLE_LINE1: fixture.tleLine1, TLE_LINE2: fixture.tleLine2,
  };
}

function counterpartRecord(): OmmRecord {
  return {
    OBJECT_NAME: 'VENUS', OBJECT_ID: '2017-044B', EPOCH: '2026-08-24T00:00:00Z',
    MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 97.4,
    RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0,
    NORAD_CAT_ID: 42901, ELEMENT_SET_NO: 1, BSTAR: 0,
    MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    TLE_LINE1: '1 42901U 17044B   26236.00000000  .00000000  00000-0  00000-0 0  9997',
    TLE_LINE2: '2 42901  97.4000 100.0000 0010000  10.0000 350.0000 15.10000000    01',
  };
}

function event(): ConjunctionRecord {
  return {
    id: '44804-42901-2026', primaryCatalogId: 44804, primaryName: 'CARTOSAT-3',
    primaryElementAgeDays: 1, secondaryCatalogId: 42901, secondaryName: 'VENUS',
    secondaryElementAgeDays: 1, tca: '2026-08-26T07:38:58.249Z', rangeKm: 1.629,
    relativeSpeedKmS: 3.538, maximumProbability: 1.623e-6, dilutionKm: 0.393,
    priority: 'watch', reasons: [], flags: [],
  };
}

describe('manoeuvre scenario physics', () => {
  it('propagates a small along-track impulse into a finite RTN displacement', () => {
    const displacement = hcwImpulseDisplacement(0.0011, 24 * 3_600, [0, 0.02, 0]);
    expect(displacement).not.toBeNull();
    expect(Math.hypot(displacement!.radial, displacement!.alongTrack, displacement!.normal)).toBeGreaterThan(1_000);
  });

  it('starts a candidate on the nominal path and produces a globe-ready trajectory', () => {
    const study = buildManeuverStudy({
      event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-25T04:00:00Z').getTime(),
    });
    const path = sampleManeuverPath(
      protectedRecord(), study.recommended!,
      new Date('2026-08-26T07:18:58.249Z'), new Date(event().tca), '#50d9b3', 24,
    );
    expect(path?.role).toBe('maneuver-study');
    expect(path?.points).toHaveLength(24);
    expect(path?.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))).toBe(true);
  });

  it('uses the rocket equation for a small positive propellant estimate', () => {
    const propellant = propellantForImpulse(1_000, 0.02, 220);
    expect(propellant).not.toBeNull();
    expect(propellant!).toBeGreaterThan(0);
    expect(propellant!).toBeLessThan(0.02);
  });

  it('returns an advisory candidate but never invents post-burn collision probability', () => {
    const study = buildManeuverStudy({
      event: event(),
      protectedRecord: protectedRecord(),
      counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-25T04:00:00Z').getTime(),
    });
    expect(study.status).toBe('ready');
    expect(study.recommended).not.toBeNull();
    expect(study.recommended!.separationGainAtSourceTcaKm).toBeGreaterThanOrEqual(2);
    expect(study.postManeuverProbability).toBeNull();
    expect(study.probabilityStatus).toContain('CDM');
  });

  it('carries the modelling method and validation gates that travel with an export', () => {
    const study = buildManeuverStudy({
      event: event(),
      protectedRecord: protectedRecord(),
      counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-25T04:00:00Z').getTime(),
    });
    expect(study.method).toContain('Hill-Clohessy-Wiltshire');
    expect(study.method).toContain('original source TCA');
    expect(study.requiredChecks.length).toBeGreaterThan(0);
    expect(study.requiredChecks.join(' ')).toContain('full catalogue');
  });

  it('prices the same separation goal higher as the decision is delayed', () => {
    const curve = leadTimeCostCurve({
      event: event(),
      protectedRecord: protectedRecord(),
      counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-25T04:00:00Z').getTime(),
    });
    expect(curve.length).toBeGreaterThan(2);
    expect(curve.map((point) => point.leadHours)).toEqual([...curve.map((point) => point.leadHours)].sort((a, b) => b - a));
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index].deltaVMps).toBeGreaterThan(curve[index - 1].deltaVMps);
      expect(curve[index].propellantGrams).toBeGreaterThan(curve[index - 1].propellantGrams);
    }
  });

  it('scales the required impulse with the inverse of lead time', () => {
    const curve = leadTimeCostCurve({
      event: event(),
      protectedRecord: protectedRecord(),
      counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-25T04:00:00Z').getTime(),
    });
    const long = curve.find((point) => point.leadHours === 24);
    const half = curve.find((point) => point.leadHours === 12);
    expect(long).toBeDefined();
    expect(half).toBeDefined();
    expect(half!.deltaVMps / long!.deltaVMps).toBeGreaterThan(1.7);
    expect(half!.deltaVMps / long!.deltaVMps).toBeLessThan(2.3);
  });

  it('never asks for more impulse than the sampled sweep already found', () => {
    const now = new Date('2026-08-25T04:00:00Z').getTime();
    const study = buildManeuverStudy({
      event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(), now,
    });
    const curve = leadTimeCostCurve({
      event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(), now,
    });
    const matching = curve.find((point) => point.leadHours === study.recommended!.leadHours);
    expect(matching).toBeDefined();
    expect(matching!.deltaVMps).toBeLessThanOrEqual(study.recommended!.deltaVMps + 1e-9);
  });

  it('does not create a late burn candidate inside six hours', () => {
    const study = buildManeuverStudy({
      event: event(),
      protectedRecord: protectedRecord(),
      counterpartRecord: counterpartRecord(),
      now: new Date('2026-08-26T03:00:00Z').getTime(),
    });
    expect(study.status).toBe('outside-window');
    expect(study.recommended).toBeNull();
  });
});
