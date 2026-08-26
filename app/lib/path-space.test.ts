import { describe, expect, it } from 'vitest';

import fleetOrbitFixture from '../data/fleet-orbits.snapshot.json';
import { buildManeuverStudy } from './maneuver';
import { buildPathSpace, encounterWindowSeconds, rtnBasis } from './path-space';
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

const NOW = new Date('2026-08-25T04:00:00Z').getTime();

function space() {
  const study = buildManeuverStudy({
    event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(), now: NOW,
  });
  return buildPathSpace({
    event: event(),
    protectedRecord: protectedRecord(),
    counterpartRecord: counterpartRecord(),
    candidates: study.rankedCandidates.slice(0, 6),
    recommendedId: study.recommended?.id ?? null,
    samples: 61,
  });
}

describe('RTN basis', () => {
  it('returns three mutually perpendicular unit vectors', () => {
    const basis = rtnBasis({ x: 7000, y: 0, z: 0 }, { x: 0, y: 7.5, z: 0 })!;
    expect(basis).not.toBeNull();
    const vectors = [basis.radial, basis.along, basis.normal];
    for (const v of vectors) {
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
    }
    const dot = (a: typeof basis.radial, b: typeof basis.radial) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(basis.radial, basis.along)).toBeCloseTo(0, 9);
    expect(dot(basis.radial, basis.normal)).toBeCloseTo(0, 9);
    expect(dot(basis.along, basis.normal)).toBeCloseTo(0, 9);
  });

  it('rejects a degenerate state', () => {
    expect(rtnBasis({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});

describe('encounter window', () => {
  it('runs the corridor to the requested multiple of the separation', () => {
    // Six times a 4 km spread at 8.544 km/s is 2.81 s of flight.
    expect(encounterWindowSeconds(4, 8.544)).toBeCloseTo(2.81, 2);
    expect(encounterWindowSeconds(4, 8.544, 20)).toBeCloseTo(9.36, 2);
  });

  it('widens and narrows with the multiplier', () => {
    const near = encounterWindowSeconds(3, 8, 3);
    const far = encounterWindowSeconds(3, 8, 24);
    expect(far).toBeGreaterThan(near);
    expect(far / near).toBeCloseTo(8, 6);
  });

  it('stays inside sane bounds for extreme inputs', () => {
    expect(encounterWindowSeconds(0.0001, 15)).toBe(0.5);
    expect(encounterWindowSeconds(5000, 1)).toBe(120);
    expect(encounterWindowSeconds(Number.NaN, null)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('path space', () => {
  it('builds a current path plus one series per candidate', () => {
    const result = space()!;
    expect(result).not.toBeNull();
    expect(result.series.length).toBeGreaterThan(1);
    expect(result.series[0].role).toBe('current');
    expect(result.series.filter((s) => s.role === 'best')).toHaveLength(1);
  });

  it('keeps every sample finite', () => {
    const result = space()!;
    for (const series of result.series) {
      for (const point of series.points) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)).toBe(true);
      }
    }
  });

  it('reproduces the published miss distance on the current path', () => {
    // The plot is anchored to the screening source, so the unburned path must
    // come to exactly the distance the event card shows. Public elements are
    // usually far too stale to recreate a conjunction unaided, which is why the
    // magnitude is taken from the source and only the direction from propagation.
    const result = space()!;
    const current = result.series.find((s) => s.role === 'current')!;
    expect(current.closestApproachKm).toBeCloseTo(event().rangeKm!, 3);
  });

  it('agrees with the manoeuvre panel on every candidate separation', () => {
    const study = buildManeuverStudy({
      event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(), now: NOW,
    });
    const result = space()!;
    for (const series of result.series.filter((s) => s.role !== 'current')) {
      const candidate = study.rankedCandidates.find((item) => item.id === series.id)!;
      // At the published closest-approach time the two must agree exactly: they
      // share a baseline by construction.
      expect(series.separationAtTcaKm).toBeCloseTo(candidate.separationAtSourceTcaKm, 6);
      // The true minimum can sit lower, because a burn also moves when the
      // encounter happens. It can never sit higher.
      expect(series.closestApproachKm).toBeLessThanOrEqual(series.separationAtTcaKm + 1e-9);
    }
  });

  it('moves every candidate further from the counterpart than doing nothing', () => {
    const result = space()!;
    const current = result.series.find((s) => s.role === 'current')!;
    for (const series of result.series.filter((s) => s.role !== 'current')) {
      expect(series.closestApproachKm).toBeGreaterThan(current.closestApproachKm);
    }
  });

  it('separates each candidate from the current path by its own predicted displacement', () => {
    // Fixture-independent: whatever the absolute geometry, a burn must move the
    // path by exactly the displacement the manoeuvre engine predicted for it.
    const study = buildManeuverStudy({
      event: event(), protectedRecord: protectedRecord(), counterpartRecord: counterpartRecord(), now: NOW,
    });
    const result = space()!;
    const current = result.series.find((s) => s.role === 'current')!;
    const atTca = (series: typeof current) => series.points.reduce(
      (best, point) => (Math.abs(point.secondsFromTca) < Math.abs(best.secondsFromTca) ? point : best),
    );
    const origin = atTca(current);

    for (const series of result.series.filter((s) => s.role !== 'current')) {
      const candidate = study.rankedCandidates.find((item) => item.id === series.id)!;
      const moved = atTca(series);
      const shift = Math.hypot(moved.x - origin.x, moved.y - origin.y, moved.z - origin.z);
      expect(shift).toBeCloseTo(candidate.displacementAtTcaKm, 2);
    }
  });

  it('gives the current path no burn arrow and every candidate a unit one', () => {
    const result = space()!;
    for (const series of result.series) {
      if (series.role === 'current') {
        expect(series.burnDirection).toBeNull();
        expect(series.deltaVMps).toBeNull();
      } else {
        const d = series.burnDirection!;
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
        expect(series.deltaVMps).toBeGreaterThan(0);
      }
    }
  });

  it('maps radial to the vertical axis and along-track to the horizontal one', () => {
    const result = space()!;
    const radial = result.series.find((s) => s.burnLabel?.startsWith('+R') || s.burnLabel?.startsWith('-R'));
    const along = result.series.find((s) => s.burnLabel?.startsWith('+T') || s.burnLabel?.startsWith('-T'));
    if (radial) {
      expect(Math.abs(radial.burnDirection!.z)).toBe(1);
      expect(radial.burnDirection!.x).toBe(0);
    }
    if (along) {
      expect(Math.abs(along.burnDirection!.x)).toBe(1);
      expect(along.burnDirection!.z).toBe(0);
    }
  });

  it('gives the counterpart its own track through the frame', () => {
    const result = space()!;
    expect(result.counterpartPoints.length).toBe(result.series[0].points.length);
    // At closest approach the pair must sit exactly the published miss apart.
    const current = result.series.find((s) => s.role === 'current')!;
    const index = current.points.findIndex((p) => p === current.closestPoint);
    const sat = current.points[index];
    const deb = result.counterpartPoints[index];
    expect(Math.hypot(sat.x - deb.x, sat.y - deb.y, sat.z - deb.z))
      .toBeCloseTo(result.sourceMissDistanceKm, 6);
  });

  it('starts both objects away from the meeting point', () => {
    const result = space()!;
    const current = result.series.find((s) => s.role === 'current')!;
    const satStart = current.points[0];
    const debStart = result.counterpartPoints[0];
    expect(Math.hypot(satStart.x, satStart.y, satStart.z)).toBeGreaterThan(result.sourceMissDistanceKm);
    expect(Math.hypot(debStart.x, debStart.y, debStart.z)).toBeGreaterThan(result.sourceMissDistanceKm);
    expect(result.travelKm).toBeGreaterThan(0);
  });

  it('sizes the frame so no path leaves the box', () => {
    const result = space()!;
    for (const series of [...result.series, { points: result.counterpartPoints }]) {
      for (const point of series.points) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(result.extentKm + 1e-6);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(result.extentKm + 1e-6);
        expect(Math.abs(point.z)).toBeLessThanOrEqual(result.extentKm + 1e-6);
      }
    }
  });

  it('returns null without both orbit records', () => {
    expect(buildPathSpace({
      event: event(), protectedRecord: null, counterpartRecord: counterpartRecord(),
      candidates: [], recommendedId: null,
    })).toBeNull();
  });
});
