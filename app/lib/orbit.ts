import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  twoline2satrec,
} from 'satellite.js';
import type { OmmRecord, OrbitPath, PropagatedObject } from './types';

const EARTH_RADIUS_KM = 6371;

export type PreparedOmm = {
  record: OmmRecord;
  satrec: ReturnType<typeof json2satrec>;
};

export function catalogId(record: OmmRecord) {
  return Number(record.NORAD_CAT_ID);
}

function epochTime(record: OmmRecord) {
  const raw = String(record.EPOCH ?? '').trim();
  if (!raw) return null;
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Keeps the newest element set while retaining catalogue metadata that a GP
 * response may omit. TLE lines belong to their own epoch, so a newer OMM must
 * clear older TLE fields or satellite.js would silently propagate the stale
 * TLE instead of the selected record.
 */
export function preferFresherOmmRecord(current: OmmRecord | undefined, incoming: OmmRecord) {
  if (!current) return incoming;
  const currentEpoch = epochTime(current);
  const incomingEpoch = epochTime(incoming);
  if (incomingEpoch === null || (currentEpoch !== null && incomingEpoch < currentEpoch)) return current;
  if (currentEpoch !== null && incomingEpoch === currentEpoch) {
    const currentHasTle = Boolean(current.TLE_LINE1 && current.TLE_LINE2);
    const incomingHasTle = Boolean(incoming.TLE_LINE1 && incoming.TLE_LINE2);
    if (currentHasTle && !incomingHasTle) return current;
  }
  return {
    ...current,
    ...incoming,
    OBJECT_TYPE: incoming.OBJECT_TYPE ?? current.OBJECT_TYPE,
    COUNTRY_CODE: incoming.COUNTRY_CODE ?? current.COUNTRY_CODE,
    LAUNCH_DATE: incoming.LAUNCH_DATE ?? current.LAUNCH_DATE,
    TLE_LINE1: incoming.TLE_LINE1,
    TLE_LINE2: incoming.TLE_LINE2,
  };
}

export function prepareOmm(record: OmmRecord): PreparedOmm | null {
  try {
    const satrec = record.TLE_LINE1 && record.TLE_LINE2
      ? twoline2satrec(record.TLE_LINE1, record.TLE_LINE2)
      : json2satrec(record as Parameters<typeof json2satrec>[0]);
    return { record, satrec };
  } catch {
    return null;
  }
}

export function propagatePreparedOmm(prepared: PreparedOmm, date: Date): PropagatedObject | null {
  try {
    const state = propagate(prepared.satrec, date);
    if (!state || !state.position || typeof state.position === 'boolean') return null;
    const geodetic = eciToGeodetic(state.position, gstime(date));
    const altitudeKm = geodetic.height;
    if (!Number.isFinite(altitudeKm)) return null;
    return {
      catalogId: catalogId(prepared.record),
      name: prepared.record.OBJECT_NAME,
      epoch: prepared.record.EPOCH,
      lat: degreesLat(geodetic.latitude),
      lng: degreesLong(geodetic.longitude),
      altitudeKm,
      altitude: Math.max(0.003, altitudeKm / EARTH_RADIUS_KM),
    };
  } catch {
    return null;
  }
}

export function propagateOmm(record: OmmRecord, date: Date): PropagatedObject | null {
  const prepared = prepareOmm(record);
  return prepared ? propagatePreparedOmm(prepared, date) : null;
}

/**
 * Samples one complete SGP4 ground track in the same Earth-fixed frame used by
 * the moving markers. The path is intentionally not forced closed: Earth
 * rotates below an inertial orbit during one revolution, so closing it would
 * create a visible seam and detach the marker from its own track.
 */
export function sampleDynamicOrbitPath(
  record: OmmRecord,
  center: Date,
  color: string,
  samples = 180,
): OrbitPath {
  const meanMotion = Number(record.MEAN_MOTION);
  const periodMs = Number.isFinite(meanMotion) && meanMotion > 0 ? (86_400_000 / meanMotion) : 5_400_000;
  const sampleCount = Math.max(3, Math.floor(samples));
  const centeredSamples = sampleCount % 2 === 0 ? sampleCount + 1 : sampleCount;
  return sampleOrbitSegment(
    record,
    new Date(center.getTime() - periodMs / 2),
    new Date(center.getTime() + periodMs / 2),
    color,
    centeredSamples,
  );
}

/**
 * Samples one complete SGP4 revolution in a fixed Earth frame for orbit-plane
 * analysis. The globe uses `sampleDynamicOrbitPath` so visible motion stays
 * aligned with the time-varying Earth-fixed satellite marker.
 */
export function sampleClosedOrbitPath(
  record: OmmRecord,
  center: Date,
  color: string,
  samples = 180,
): OrbitPath {
  const prepared = prepareOmm(record);
  const meanMotion = Number(record.MEAN_MOTION);
  const periodMs = Number.isFinite(meanMotion) && meanMotion > 0 ? (86_400_000 / meanMotion) : 5_400_000;
  const start = center.getTime() - periodMs / 2;
  const sampleCount = Math.max(3, Math.floor(samples));
  const uniquePointCount = sampleCount - 1;
  const fixedGmst = gstime(center);
  const points = Array.from({ length: uniquePointCount }, (_, index) => {
    if (!prepared) return null;
    const date = new Date(start + (index / uniquePointCount) * periodMs);
    const state = propagate(prepared.satrec, date);
    if (!state || !state.position || typeof state.position === 'boolean') return null;
    const geodetic = eciToGeodetic(state.position, fixedGmst);
    if (!Number.isFinite(geodetic.height)) return null;
    return {
      lat: degreesLat(geodetic.latitude),
      lng: degreesLong(geodetic.longitude),
      altitude: Math.max(0.003, geodetic.height / EARTH_RADIUS_KM),
    };
  }).filter((point): point is { lat: number; lng: number; altitude: number } => Boolean(point));

  if (points.length) points.push({ ...points[0] });

  return {
    catalogId: catalogId(record),
    name: record.OBJECT_NAME,
    color,
    points,
  };
}

export function sampleOrbitSegment(
  record: OmmRecord,
  start: Date,
  end: Date,
  color: string,
  samples = 120,
): OrbitPath {
  const prepared = prepareOmm(record);
  const startTime = start.getTime();
  const endTime = end.getTime();
  const sampleCount = Math.max(2, samples);
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const timestamp = startTime + (index / (sampleCount - 1)) * (endTime - startTime);
    return prepared ? propagatePreparedOmm(prepared, new Date(timestamp)) : null;
  })
    .filter((point): point is PropagatedObject => Boolean(point))
    .map(({ lat, lng, altitude }) => ({ lat, lng, altitude }));

  return {
    catalogId: catalogId(record),
    name: record.OBJECT_NAME,
    color,
    points,
  };
}

type Vector = { x: number; y: number; z: number };

function magnitude(vector: Vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function unit(vector: Vector) {
  const length = magnitude(vector);
  if (!length) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(a: Vector, b: Vector): Vector {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vector, b: Vector) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function relativeRtnFromOmm(primary: OmmRecord, secondary: OmmRecord, date: Date) {
  try {
    const preparedPrimary = prepareOmm(primary);
    const preparedSecondary = prepareOmm(secondary);
    if (!preparedPrimary || !preparedSecondary) return null;
    const primaryState = propagate(preparedPrimary.satrec, date);
    const secondaryState = propagate(preparedSecondary.satrec, date);
    if (!primaryState || !secondaryState ||
        !primaryState.position || typeof primaryState.position === 'boolean' ||
        !primaryState.velocity || typeof primaryState.velocity === 'boolean' ||
        !secondaryState.position || typeof secondaryState.position === 'boolean') return null;
    const rHat = unit(primaryState.position);
    const nHat = unit(cross(primaryState.position, primaryState.velocity));
    if (!rHat || !nHat) return null;
    const tHat = unit(cross(nHat, rHat));
    if (!tHat) return null;
    const relative = {
      x: secondaryState.position.x - primaryState.position.x,
      y: secondaryState.position.y - primaryState.position.y,
      z: secondaryState.position.z - primaryState.position.z,
    };
    return {
      r: dot(relative, rHat) * 1000,
      t: dot(relative, tHat) * 1000,
      n: dot(relative, nHat) * 1000,
      distanceKm: magnitude(relative),
    };
  } catch {
    return null;
  }
}
