import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate } from 'satellite.js';

import { prepareOmm, relativeRtnFromOmm } from './orbit';
import type { ConjunctionRecord, OmmRecord, OrbitPath } from './types';

const STANDARD_GRAVITY = 9.80665;
const SECONDS_PER_DAY = 86_400;
export const MAX_ADVISORY_DELTA_V_MPS = 0.25;

export type RtnAxis = 'R' | 'T' | 'N';
export type ManeuverDirection = '+R' | '-R' | '+T' | '-T' | '+N' | '-N';

export type ManeuverAssumptions = {
  spacecraftMassKg: number;
  specificImpulseSeconds: number;
  thrustNewtons: number;
  targetSeparationGainKm: number;
};

export type ManeuverCandidate = {
  id: string;
  direction: ManeuverDirection;
  axis: RtnAxis;
  directionLabel: string;
  burnTime: string;
  leadHours: number;
  deltaVMps: number;
  displacementAtTcaKm: number;
  separationAtSourceTcaKm: number;
  separationGainAtSourceTcaKm: number;
  propellantGrams: number;
  burnDurationSeconds: number;
  efficiencyKmPerCentimeterSecond: number;
  geometricExposureReductionPercent: number;
};

export type ManeuverStudy = {
  status: 'ready' | 'insufficient-data' | 'outside-window';
  reason: string;
  sourceMaximumProbability: number | null;
  sourceMissDistanceKm: number | null;
  postManeuverProbability: null;
  probabilityStatus: string;
  recommended: ManeuverCandidate | null;
  alternatives: ManeuverCandidate[];
  assumptions: ManeuverAssumptions;
  method: string;
  requiredChecks: string[];
};

export const DEFAULT_MANEUVER_ASSUMPTIONS: ManeuverAssumptions = {
  spacecraftMassKg: 1_000,
  specificImpulseSeconds: 220,
  thrustNewtons: 20,
  targetSeparationGainKm: 2,
};

const directions: Array<{ direction: ManeuverDirection; axis: RtnAxis; vector: [number, number, number]; label: string }> = [
  { direction: '+R', axis: 'R', vector: [1, 0, 0], label: 'Radial outward' },
  { direction: '-R', axis: 'R', vector: [-1, 0, 0], label: 'Radial inward' },
  { direction: '+T', axis: 'T', vector: [0, 1, 0], label: 'Along-track prograde' },
  { direction: '-T', axis: 'T', vector: [0, -1, 0], label: 'Along-track retrograde' },
  { direction: '+N', axis: 'N', vector: [0, 0, 1], label: 'Positive orbit-normal' },
  { direction: '-N', axis: 'N', vector: [0, 0, -1], label: 'Negative orbit-normal' },
];

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function hcwImpulseDisplacement(
  meanMotionRadS: number,
  elapsedSeconds: number,
  deltaVelocityMps: [number, number, number],
) {
  if (!finitePositive(meanMotionRadS) || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return null;
  const [radialVelocity, alongTrackVelocity, normalVelocity] = deltaVelocityMps;
  const angle = meanMotionRadS * elapsedSeconds;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const radial = (sine / meanMotionRadS) * radialVelocity
    + (2 * (1 - cosine) / meanMotionRadS) * alongTrackVelocity;
  const alongTrack = (-2 * (1 - cosine) / meanMotionRadS) * radialVelocity
    + ((4 * sine - 3 * angle) / meanMotionRadS) * alongTrackVelocity;
  const normal = (sine / meanMotionRadS) * normalVelocity;
  return { radial, alongTrack, normal };
}

function vectorMagnitude(vector: { x: number; y: number; z: number }) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalized(vector: { x: number; y: number; z: number }) {
  const magnitude = vectorMagnitude(vector);
  if (!magnitude) return null;
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude };
}

function vectorCross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function sampleSgp4AnchoredManeuverPath(
  record: OmmRecord,
  candidate: ManeuverCandidate,
  start: Date,
  end: Date,
  color: string,
  samples = 96,
): OrbitPath | null {
  const prepared = prepareOmm(record);
  const meanMotionRevolutionsPerDay = Number(record.MEAN_MOTION);
  const burnTime = new Date(candidate.burnTime).getTime();
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!prepared || !finitePositive(meanMotionRevolutionsPerDay) || !Number.isFinite(burnTime) || endTime <= startTime) return null;
  const meanMotionRadS = meanMotionRevolutionsPerDay * Math.PI * 2 / SECONDS_PER_DAY;
  const option = directions.find((item) => item.direction === candidate.direction);
  if (!option) return null;
  const impulse: [number, number, number] = [
    option.vector[0] * candidate.deltaVMps,
    option.vector[1] * candidate.deltaVMps,
    option.vector[2] * candidate.deltaVMps,
  ];
  const sampleCount = Math.max(2, Math.floor(samples));
  const points: Array<{ lat: number; lng: number; altitude: number }> = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const timestamp = startTime + index / (sampleCount - 1) * (endTime - startTime);
    const state = propagate(prepared.satrec, new Date(timestamp));
    if (!state || !state.position || typeof state.position === 'boolean' || !state.velocity || typeof state.velocity === 'boolean') return null;
    const rHat = normalized(state.position);
    const nHat = normalized(vectorCross(state.position, state.velocity));
    if (!rHat || !nHat) return null;
    const tHat = normalized(vectorCross(nHat, rHat));
    if (!tHat) return null;
    const displacement = hcwImpulseDisplacement(meanMotionRadS, Math.max(0, (timestamp - burnTime) / 1_000), impulse);
    if (!displacement) return null;
    const position = {
      x: state.position.x + (rHat.x * displacement.radial + tHat.x * displacement.alongTrack + nHat.x * displacement.normal) / 1_000,
      y: state.position.y + (rHat.y * displacement.radial + tHat.y * displacement.alongTrack + nHat.y * displacement.normal) / 1_000,
      z: state.position.z + (rHat.z * displacement.radial + tHat.z * displacement.alongTrack + nHat.z * displacement.normal) / 1_000,
    };
    const geodetic = eciToGeodetic(position, gstime(new Date(timestamp)));
    if (!Number.isFinite(geodetic.height)) return null;
    points.push({
      lat: degreesLat(geodetic.latitude),
      lng: degreesLong(geodetic.longitude),
      altitude: Math.max(0.003, geodetic.height / 6_371),
    });
  }
  if (points.length < 2) return null;
  return { catalogId: -4, name: 'SGP4-anchored lowest-fuel path', color, role: 'maneuver-study', points };
}

export function propellantForImpulse(massKg: number, deltaVMps: number, specificImpulseSeconds: number) {
  if (!finitePositive(massKg) || !finitePositive(deltaVMps) || !finitePositive(specificImpulseSeconds)) return null;
  return massKg * (1 - Math.exp(-deltaVMps / (specificImpulseSeconds * STANDARD_GRAVITY)));
}

function normalizedRtnDirection(
  event: ConjunctionRecord,
  protectedRecord: OmmRecord,
  counterpartRecord: OmmRecord,
) {
  const geometry = relativeRtnFromOmm(protectedRecord, counterpartRecord, new Date(event.tca));
  if (!geometry) return null;
  const length = Math.hypot(geometry.r, geometry.t, geometry.n);
  if (!finitePositive(length)) return null;
  return { r: geometry.r / length, t: geometry.t / length, n: geometry.n / length };
}

function planningLeadTimes(hoursToTca: number) {
  const preferred = [48, 36, 24].filter((hours) => hours <= hoursToTca - 0.5);
  if (preferred.length) return preferred;
  if (hoursToTca >= 6.5) return [Math.floor(hoursToTca - 0.5)];
  return [];
}

export function buildManeuverStudy({
  event,
  protectedRecord,
  counterpartRecord,
  now,
  assumptions = DEFAULT_MANEUVER_ASSUMPTIONS,
}: {
  event: ConjunctionRecord;
  protectedRecord: OmmRecord | null | undefined;
  counterpartRecord: OmmRecord | null | undefined;
  now: number;
  assumptions?: ManeuverAssumptions;
}): ManeuverStudy {
  const base: Omit<ManeuverStudy, 'status' | 'reason' | 'recommended' | 'alternatives'> = {
    sourceMaximumProbability: event.maximumProbability,
    sourceMissDistanceKm: event.rangeKm,
    postManeuverProbability: null,
    probabilityStatus: 'Requires an operator CDM with covariance, hard-body radius and a full-catalogue rescreen.',
    assumptions,
    method: 'SGP4 propagates the public OMM/TLE reference orbit. Linearized Hill-Clohessy-Wiltshire R-T-N relative motion then previews a small impulsive offset from that reference. The optimizer solves the exact minimum delta-v needed to reach the selected separation gain at the original source TCA, not a recomputed closest approach. It excludes covariance-backed probability, J2 beyond the reference elements, drag changes, finite-burn attitude and mission constraints.',
    requiredChecks: [
      'Replace public elements with an operator ephemeris and covariance-backed CDM.',
      'Verify thruster, attitude, payload and mission-timeline constraints.',
      'Screen the planned ephemeris against the full catalogue for secondary conjunctions.',
      'Require flight-dynamics review and mission-authority approval before execution.',
    ],
  };

  if (!protectedRecord || !counterpartRecord || event.rangeKm === null || !finitePositive(event.rangeKm)) {
    return { ...base, status: 'insufficient-data', reason: 'The selected pair does not have enough public geometry for a manoeuvre study.', recommended: null, alternatives: [] };
  }
  const meanMotionRevolutionsPerDay = Number(protectedRecord.MEAN_MOTION);
  const eccentricity = Number(protectedRecord.ECCENTRICITY);
  if (!finitePositive(meanMotionRevolutionsPerDay) || !Number.isFinite(eccentricity) || eccentricity > 0.01) {
    return { ...base, status: 'insufficient-data', reason: 'The linearized near-circular model is not suitable for this orbit record.', recommended: null, alternatives: [] };
  }
  const tca = new Date(event.tca).getTime();
  const hoursToTca = (tca - now) / 3_600_000;
  const leadTimes = planningLeadTimes(hoursToTca);
  if (!leadTimes.length) {
    return { ...base, status: 'outside-window', reason: 'Fewer than six hours remain before TCA, so this prototype will not create a late manoeuvre candidate.', recommended: null, alternatives: [] };
  }
  const encounterDirection = normalizedRtnDirection(event, protectedRecord, counterpartRecord);
  if (!encounterDirection) {
    return { ...base, status: 'insufficient-data', reason: 'The current public elements could not produce a stable R-T-N encounter direction.', recommended: null, alternatives: [] };
  }

  const meanMotionRadS = meanMotionRevolutionsPerDay * Math.PI * 2 / SECONDS_PER_DAY;
  const baseline = {
    r: encounterDirection.r * event.rangeKm,
    t: encounterDirection.t * event.rangeKm,
    n: encounterDirection.n * event.rangeKm,
  };
  const baselineSquared = event.rangeKm * event.rangeKm;
  const targetKm = event.rangeKm + assumptions.targetSeparationGainKm;
  const targetSquared = targetKm * targetKm;
  const candidates: ManeuverCandidate[] = [];
  for (const leadHours of leadTimes) {
    const elapsedSeconds = leadHours * 3_600;
    for (const option of directions) {
      const perUnit = hcwImpulseDisplacement(meanMotionRadS, elapsedSeconds, option.vector);
      if (!perUnit) continue;
      const perUnitKm = { r: perUnit.radial / 1_000, t: perUnit.alongTrack / 1_000, n: perUnit.normal / 1_000 };
      const displacementSquared = perUnitKm.r ** 2 + perUnitKm.t ** 2 + perUnitKm.n ** 2;
      if (!finitePositive(displacementSquared)) continue;
      const projection = baseline.r * perUnitKm.r + baseline.t * perUnitKm.t + baseline.n * perUnitKm.n;
      const discriminant = projection * projection + displacementSquared * (targetSquared - baselineSquared);
      if (discriminant < 0) continue;
      const deltaVMps = (projection + Math.sqrt(discriminant)) / displacementSquared;
      if (!finitePositive(deltaVMps) || deltaVMps > MAX_ADVISORY_DELTA_V_MPS) continue;
      const displacementKm = {
        r: perUnitKm.r * deltaVMps,
        t: perUnitKm.t * deltaVMps,
        n: perUnitKm.n * deltaVMps,
      };
      const separationAtSourceTcaKm = Math.hypot(
        baseline.r - displacementKm.r,
        baseline.t - displacementKm.t,
        baseline.n - displacementKm.n,
      );
      const displacementAtTcaKm = Math.hypot(displacementKm.r, displacementKm.t, displacementKm.n);
      const propellantKg = propellantForImpulse(assumptions.spacecraftMassKg, deltaVMps, assumptions.specificImpulseSeconds);
      if (propellantKg === null) continue;
      candidates.push({
        id: `${leadHours}-${option.direction}-${deltaVMps.toFixed(9)}`,
        direction: option.direction,
        axis: option.axis,
        directionLabel: option.label,
        burnTime: new Date(tca - elapsedSeconds * 1_000).toISOString(),
        leadHours,
        deltaVMps,
        displacementAtTcaKm,
        separationAtSourceTcaKm,
        separationGainAtSourceTcaKm: separationAtSourceTcaKm - event.rangeKm,
        propellantGrams: propellantKg * 1_000,
        burnDurationSeconds: assumptions.thrustNewtons > 0
          ? propellantKg * assumptions.specificImpulseSeconds * STANDARD_GRAVITY / assumptions.thrustNewtons
          : 0,
        efficiencyKmPerCentimeterSecond: displacementAtTcaKm / (deltaVMps * 100),
        geometricExposureReductionPercent: clamp(
          (1 - baselineSquared / (separationAtSourceTcaKm * separationAtSourceTcaKm)) * 100,
          0,
          99.9,
        ),
      });
    }
  }

  const goalCandidates = candidates.filter((candidate) => candidate.separationGainAtSourceTcaKm >= assumptions.targetSeparationGainKm - 1e-8);
  const ranked = [...goalCandidates].sort((first, second) => (
    first.propellantGrams - second.propellantGrams
    || first.displacementAtTcaKm - second.displacementAtTcaKm
    || second.leadHours - first.leadHours
  ));
  const recommended = ranked[0] ?? null;
  const alternatives = ranked.filter((candidate) => candidate.id !== recommended?.id).slice(0, 2);
  return {
    ...base,
    status: recommended ? 'ready' : 'insufficient-data',
    reason: recommended
      ? `Exact lowest-propellant candidate that adds ${assumptions.targetSeparationGainKm.toFixed(1)} km of separation at the source TCA while minimizing path movement in the current public-element geometry.`
      : `No advisory impulse below ${MAX_ADVISORY_DELTA_V_MPS.toFixed(2)} m/s reached the ${assumptions.targetSeparationGainKm.toFixed(1)} km separation-gain objective at the source TCA.`,
    recommended,
    alternatives,
  };
}

const COST_CURVE_LEAD_HOURS = [48, 36, 24, 18, 12, 6, 3];

export type LeadTimeCost = {
  leadHours: number;
  deltaVMps: number;
  propellantGrams: number;
  direction: ManeuverDirection;
  /** False when the impulse exceeds the advisory cap the candidate ranking enforces. */
  withinTestedRange: boolean;
};

/**
 * Minimum impulse that reaches the separation goal at each decision time.
 *
 * Separation at the source TCA is quadratic in the impulse magnitude along a
 * fixed direction, so the required delta-v has a closed form matching the
 * optimizer used by `buildManeuverStudy`.
 */
export function leadTimeCostCurve({
  event,
  protectedRecord,
  counterpartRecord,
  now,
  assumptions = DEFAULT_MANEUVER_ASSUMPTIONS,
}: {
  event: ConjunctionRecord;
  protectedRecord: OmmRecord | null | undefined;
  counterpartRecord: OmmRecord | null | undefined;
  now: number;
  assumptions?: ManeuverAssumptions;
}): LeadTimeCost[] {
  if (!protectedRecord || !counterpartRecord || event.rangeKm === null || !finitePositive(event.rangeKm)) return [];
  const meanMotionRevolutionsPerDay = Number(protectedRecord.MEAN_MOTION);
  if (!finitePositive(meanMotionRevolutionsPerDay)) return [];
  const encounterDirection = normalizedRtnDirection(event, protectedRecord, counterpartRecord);
  if (!encounterDirection) return [];

  const hoursToTca = (new Date(event.tca).getTime() - now) / 3_600_000;
  const ladder = COST_CURVE_LEAD_HOURS.filter((hours) => hours <= hoursToTca - 0.5);
  if (ladder.length < 2) return [];

  const meanMotionRadS = meanMotionRevolutionsPerDay * Math.PI * 2 / SECONDS_PER_DAY;
  const baseline = {
    r: encounterDirection.r * event.rangeKm,
    t: encounterDirection.t * event.rangeKm,
    n: encounterDirection.n * event.rangeKm,
  };
  const baselineSquared = event.rangeKm * event.rangeKm;
  const targetKm = event.rangeKm + assumptions.targetSeparationGainKm;
  const targetSquared = targetKm * targetKm;

  const curve: LeadTimeCost[] = [];
  for (const leadHours of ladder) {
    let best: { deltaVMps: number; direction: ManeuverDirection } | null = null;
    for (const option of directions) {
      const perUnit = hcwImpulseDisplacement(meanMotionRadS, leadHours * 3_600, option.vector);
      if (!perUnit) continue;
      const displacement = { r: perUnit.radial / 1_000, t: perUnit.alongTrack / 1_000, n: perUnit.normal / 1_000 };
      const displacementSquared = displacement.r ** 2 + displacement.t ** 2 + displacement.n ** 2;
      if (!finitePositive(displacementSquared)) continue;
      const projection = baseline.r * displacement.r + baseline.t * displacement.t + baseline.n * displacement.n;
      const discriminant = projection * projection + displacementSquared * (targetSquared - baselineSquared);
      if (discriminant < 0) continue;
      const deltaVMps = (projection + Math.sqrt(discriminant)) / displacementSquared;
      if (!finitePositive(deltaVMps)) continue;
      if (!best || deltaVMps < best.deltaVMps) best = { deltaVMps, direction: option.direction };
    }
    if (!best) continue;
    const propellantKg = propellantForImpulse(assumptions.spacecraftMassKg, best.deltaVMps, assumptions.specificImpulseSeconds);
    if (propellantKg === null) continue;
    curve.push({
      leadHours,
      deltaVMps: best.deltaVMps,
      propellantGrams: propellantKg * 1_000,
      direction: best.direction,
      withinTestedRange: best.deltaVMps <= MAX_ADVISORY_DELTA_V_MPS,
    });
  }
  return curve;
}

export function sanitizeManeuverAssumptions(input: ManeuverAssumptions): ManeuverAssumptions {
  const safe = (value: number, fallback: number, minimum: number, maximum: number) => (
    Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback
  );
  return {
    spacecraftMassKg: safe(input.spacecraftMassKg, DEFAULT_MANEUVER_ASSUMPTIONS.spacecraftMassKg, 1, 20_000),
    specificImpulseSeconds: safe(input.specificImpulseSeconds, DEFAULT_MANEUVER_ASSUMPTIONS.specificImpulseSeconds, 20, 5_000),
    thrustNewtons: safe(input.thrustNewtons, DEFAULT_MANEUVER_ASSUMPTIONS.thrustNewtons, 0.01, 50_000),
    targetSeparationGainKm: safe(input.targetSeparationGainKm, DEFAULT_MANEUVER_ASSUMPTIONS.targetSeparationGainKm, 0.1, 20),
  };
}
