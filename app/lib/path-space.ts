import { propagate } from 'satellite.js';

import { hcwImpulseDisplacement, type ManeuverCandidate } from './maneuver';
import { prepareOmm } from './orbit';
import type { ConjunctionRecord, OmmRecord } from './types';

const SECONDS_PER_DAY = 86_400;

/**
 * Encounter geometry for the three-dimensional path view.
 *
 * The globe cannot show this. A kilometre of separation against a 6,371 km
 * Earth is a third of a pixel, so every candidate path collapses onto the
 * nominal one. This module rebuilds the same geometry in the only frame where
 * the separation is the whole picture: the protected satellite's local
 * radial/along-track/cross-track axes, with the counterpart pinned at the
 * origin.
 *
 * Axis mapping, chosen so the plot reads the way a person expects:
 *
 *   x  along-track  (T)  horizontal, direction of travel
 *   y  cross-track  (N)  horizontal, across the orbit plane
 *   z  radial       (R)  vertical, altitude
 *
 * x and y therefore span the local horizontal plane and z is height. The basis
 * is taken once from the nominal state at closest approach and held fixed, so
 * every path is measured against the same axes.
 */

export type PathRole = 'current' | 'best' | 'alternative';

export type PathPoint = { x: number; y: number; z: number; secondsFromTca: number };

export type PathSeries = {
  id: string;
  role: PathRole;
  label: string;
  detail: string;
  points: PathPoint[];
  /** True minimum separation over the window. */
  closestApproachKm: number;
  /**
   * Separation at the published closest-approach time.
   *
   * The manoeuvre engine holds that time fixed, so this is the figure the panel
   * quotes. A burn also shifts *when* the encounter happens, so the true minimum
   * above can sit slightly lower. The difference is the fixed-time
   * simplification, made visible rather than hidden.
   */
  separationAtTcaKm: number;
  closestPoint: PathPoint;
  /** Unit impulse direction in plot axes. Null for the current path, which has no burn. */
  burnDirection: { x: number; y: number; z: number } | null;
  burnLabel: string | null;
  deltaVMps: number | null;
  propellantGrams: number | null;
};

export type PathSpace = {
  series: PathSeries[];
  /** The counterpart's own track through the same frame, so both objects move. */
  counterpartPoints: PathPoint[];
  /** Half-extent of the cube that contains every path, in kilometres. */
  extentKm: number;
  windowSeconds: number;
  /** Distance each object covers across the window, in kilometres. */
  travelKm: number;
  sourceMissDistanceKm: number;
  relativeSpeedKmS: number;
  /** How the geometry was reconstructed. Shown to the viewer verbatim. */
  model: string;
};

const DIRECTION_VECTORS: Record<string, { x: number; y: number; z: number }> = {
  '+R': { x: 0, y: 0, z: 1 },
  '-R': { x: 0, y: 0, z: -1 },
  '+T': { x: 1, y: 0, z: 0 },
  '-T': { x: -1, y: 0, z: 0 },
  '+N': { x: 0, y: 1, z: 0 },
  '-N': { x: 0, y: -1, z: 0 },
};

type Vector = { x: number; y: number; z: number };

function subtract(a: Vector, b: Vector): Vector {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vector, b: Vector): Vector {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vector, b: Vector) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(v: Vector) {
  return Math.hypot(v.x, v.y, v.z);
}

function unit(v: Vector): Vector | null {
  const length = magnitude(v);
  if (!Number.isFinite(length) || length === 0) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function stateAt(satrec: ReturnType<typeof prepareOmm> extends null ? never : NonNullable<ReturnType<typeof prepareOmm>>['satrec'], date: Date) {
  const state = propagate(satrec, date);
  if (!state || !state.position || typeof state.position === 'boolean') return null;
  if (!state.velocity || typeof state.velocity === 'boolean') return null;
  return { position: state.position as Vector, velocity: state.velocity as Vector };
}

/** Radial, along-track and cross-track unit vectors for a state, in the inertial frame. */
export function rtnBasis(position: Vector, velocity: Vector) {
  const radial = unit(position);
  const normal = unit(cross(position, velocity));
  if (!radial || !normal) return null;
  const along = unit(cross(normal, radial));
  if (!along) return null;
  return { radial, along, normal };
}

/**
 * Window length that frames the encounter without distorting any axis.
 *
 * A conjunction at eight kilometres a second is over in seconds, so the window
 * is derived from the geometry rather than fixed: long enough that the corridor
 * reads as a direction of travel, short enough that a few kilometres of
 * separation stays visible at a true one-to-one aspect ratio.
 */
export function encounterWindowSeconds(
  maxSeparationKm: number,
  relativeSpeedKmS: number | null,
  multiplier = 6,
) {
  const speed = relativeSpeedKmS && relativeSpeedKmS > 0 ? relativeSpeedKmS : 7.5;
  const separation = Number.isFinite(maxSeparationKm) && maxSeparationKm > 0 ? maxSeparationKm : 1;
  const span = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 6;
  return Math.min(120, Math.max(0.5, (span * separation) / speed));
}

export function buildPathSpace({
  event,
  protectedRecord,
  counterpartRecord,
  candidates,
  recommendedId,
  samples = 121,
  windowMultiplier = 6,
}: {
  event: ConjunctionRecord;
  protectedRecord: OmmRecord | null | undefined;
  counterpartRecord: OmmRecord | null | undefined;
  candidates: ManeuverCandidate[];
  recommendedId: string | null;
  samples?: number;
  /** How far the corridor runs, as a multiple of the widest separation. */
  windowMultiplier?: number;
}): PathSpace | null {
  if (!protectedRecord || !counterpartRecord) return null;
  const preparedProtected = prepareOmm(protectedRecord);
  const preparedCounterpart = prepareOmm(counterpartRecord);
  if (!preparedProtected || !preparedCounterpart) return null;

  const tca = new Date(event.tca).getTime();
  if (!Number.isFinite(tca)) return null;
  const missKm = event.rangeKm;
  if (missKm === null || !Number.isFinite(missKm) || missKm <= 0) return null;

  const tcaProtected = stateAt(preparedProtected.satrec, new Date(tca));
  const tcaCounterpart = stateAt(preparedCounterpart.satrec, new Date(tca));
  if (!tcaProtected || !tcaCounterpart) return null;
  const basis = rtnBasis(tcaProtected.position, tcaProtected.velocity);
  if (!basis) return null;

  const project = (vector: Vector): Vector => ({
    x: dot(vector, basis.along),
    y: dot(vector, basis.normal),
    z: dot(vector, basis.radial),
  });

  // Same convention the manoeuvre engine uses: the published miss distance sets
  // the magnitude and propagation supplies only the direction. Public elements
  // are routinely too stale to recreate a conjunction on their own, so anchoring
  // to the screening source is what keeps this plot and the panel consistent.
  const separationDirection = unit(project(subtract(tcaProtected.position, tcaCounterpart.position)));
  if (!separationDirection) return null;
  const baseline: Vector = {
    x: separationDirection.x * missKm,
    y: separationDirection.y * missKm,
    z: separationDirection.z * missKm,
  };

  // At closest approach the relative velocity is perpendicular to the miss
  // vector. Enforcing that puts the sampled minimum exactly on TCA.
  const relativeVelocity = project(subtract(tcaProtected.velocity, tcaCounterpart.velocity));
  const alongSeparation = dot(relativeVelocity, separationDirection);
  const perpendicular = unit({
    x: relativeVelocity.x - separationDirection.x * alongSeparation,
    y: relativeVelocity.y - separationDirection.y * alongSeparation,
    z: relativeVelocity.z - separationDirection.z * alongSeparation,
  });
  if (!perpendicular) return null;
  const speedKmS = event.relativeSpeedKmS && event.relativeSpeedKmS > 0
    ? event.relativeSpeedKmS
    : magnitude(relativeVelocity) || 7.5;

  const meanMotionRevolutionsPerDay = Number(protectedRecord.MEAN_MOTION);
  const meanMotionRadS = Number.isFinite(meanMotionRevolutionsPerDay) && meanMotionRevolutionsPerDay > 0
    ? (meanMotionRevolutionsPerDay * Math.PI * 2) / SECONDS_PER_DAY
    : null;

  const widestSeparation = candidates.reduce(
    (widest, candidate) => Math.max(widest, candidate.separationAtSourceTcaKm),
    missKm,
  );
  const windowSeconds = encounterWindowSeconds(widestSeparation, speedKmS, windowMultiplier);
  const sampleCount = Math.max(9, Math.floor(samples));

  // Both objects are drawn moving through the frame, which is centred on where
  // the protected satellite would be at closest approach. Over a window of
  // seconds the motion is straight, so a velocity and a time is enough.
  const satelliteVelocity = project(tcaProtected.velocity);
  const travelKm = magnitude(satelliteVelocity) * (windowSeconds / 2);

  const buildSeries = (candidate: ManeuverCandidate | null): PathSeries | null => {
    const option = candidate ? DIRECTION_VECTORS[candidate.direction] : null;
    if (candidate && !option) return null;

    // The burn happened hours before this window, so its displacement is a fixed
    // offset across the few seconds the plot covers.
    let offset: Vector = { x: 0, y: 0, z: 0 };
    if (candidate && option) {
      if (meanMotionRadS === null) return null;
      const displacement = hcwImpulseDisplacement(meanMotionRadS, candidate.leadHours * 3600, [
        option.z * candidate.deltaVMps,
        option.x * candidate.deltaVMps,
        option.y * candidate.deltaVMps,
      ]);
      if (!displacement) return null;
      offset = {
        x: displacement.alongTrack / 1000,
        y: displacement.normal / 1000,
        z: displacement.radial / 1000,
      };
    }

    const points: PathPoint[] = [];
    let closest: PathPoint | null = null;
    let closestKm = Infinity;
    const separationAtTcaKm = magnitude({
      x: baseline.x + offset.x,
      y: baseline.y + offset.y,
      z: baseline.z + offset.z,
    });
    for (let index = 0; index < sampleCount; index += 1) {
      const secondsFromTca = -windowSeconds / 2 + (index / (sampleCount - 1)) * windowSeconds;
      // Where the satellite actually is, relative to its own unburned position
      // at closest approach. The origin is therefore the satellite at TCA.
      const absolute: Vector = {
        x: satelliteVelocity.x * secondsFromTca + offset.x,
        y: satelliteVelocity.y * secondsFromTca + offset.y,
        z: satelliteVelocity.z * secondsFromTca + offset.z,
      };
      const point: PathPoint = { ...absolute, secondsFromTca };
      points.push(point);

      // Separation still comes from the verified relative construction, so the
      // numbers stay identical to the manoeuvre panel.
      const travel = speedKmS * secondsFromTca;
      const separation = magnitude({
        x: baseline.x + perpendicular.x * travel + offset.x,
        y: baseline.y + perpendicular.y * travel + offset.y,
        z: baseline.z + perpendicular.z * travel + offset.z,
      });
      if (separation < closestKm) {
        closestKm = separation;
        closest = point;
      }
    }
    if (!closest || points.length < 2) return null;

    const role: PathRole = !candidate ? 'current' : candidate.id === recommendedId ? 'best' : 'alternative';
    return {
      id: candidate ? candidate.id : 'current',
      role,
      label: !candidate ? 'Current path' : role === 'best' ? 'Recommended burn' : `${candidate.direction} burn`,
      detail: !candidate
        ? 'No burn. This is where the satellite goes if nothing is done.'
        : `${candidate.directionLabel} \u00b7 ${(candidate.deltaVMps * 100).toFixed(2)} cm/s \u00b7 ${candidate.propellantGrams.toFixed(1)} g`,
      points,
      closestApproachKm: closestKm,
      separationAtTcaKm,
      closestPoint: closest,
      burnDirection: option,
      burnLabel: candidate ? `${candidate.direction} \u00b7 ${candidate.directionLabel}` : null,
      deltaVMps: candidate ? candidate.deltaVMps : null,
      propellantGrams: candidate ? candidate.propellantGrams : null,
    };
  };

  const current = buildSeries(null);
  if (!current) return null;
  const built = candidates
    .map((candidate) => buildSeries(candidate))
    .filter((item): item is PathSeries => Boolean(item));

  const series = [current, ...built];

  // counterpart(t) = satellite(t) - relative(t), so the pair stays exactly the
  // published miss apart at closest approach.
  const counterpartPoints: PathPoint[] = current.points.map((point) => {
    const travel = speedKmS * point.secondsFromTca;
    return {
      x: point.x - (baseline.x + perpendicular.x * travel),
      y: point.y - (baseline.y + perpendicular.y * travel),
      z: point.z - (baseline.z + perpendicular.z * travel),
      secondsFromTca: point.secondsFromTca,
    };
  });

  const allPoints = [...series.flatMap((item) => item.points), ...counterpartPoints];
  const extentKm = allPoints.reduce(
    (widest, point) => Math.max(widest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)),
    0.5,
  );

  return {
    series,
    counterpartPoints,
    extentKm,
    windowSeconds,
    travelKm,
    sourceMissDistanceKm: missKm,
    relativeSpeedKmS: speedKmS,
    model: 'Linearized encounter. The published miss distance sets the separation and propagation supplies only its direction, which is the convention the manoeuvre engine already uses. Relative motion is straight across this window, which lasts seconds.',
  };
}
