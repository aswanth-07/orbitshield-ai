import { isSatelliteObjectType } from './collision-visualization';
import { comparePriority } from './screening';
import type { ConjunctionRecord, ThreatObject } from './types';

export type MonitoredState = {
  label: 'Review' | 'Watch' | 'Low' | 'Needs data' | 'Clear' | 'Connector needed';
  tone: 'review' | 'watch' | 'low' | 'needs-data' | 'clear';
};

export function eventForSatellite(events: ConjunctionRecord[], catalogId: number) {
  return events
    .filter((event) => event.primaryCatalogId === catalogId || event.secondaryCatalogId === catalogId)
    .sort(comparePriority)[0] ?? null;
}

export function eventTouchesMonitoringList(event: ConjunctionRecord, monitoredIds: Iterable<number>) {
  const ids = monitoredIds instanceof Set ? monitoredIds : new Set(monitoredIds);
  return ids.has(event.primaryCatalogId) || ids.has(event.secondaryCatalogId);
}

export function isFutureConjunction(event: ConjunctionRecord, now: number) {
  const tca = new Date(event.tca).getTime();
  return Number.isFinite(tca) && tca > now;
}

export function normalizeMonitoringIds(values: unknown, limit = 12) {
  if (!Array.isArray(values)) return [];
  const ids: number[] = [];
  for (const value of values) {
    const catalogId = Number(value);
    if (!Number.isInteger(catalogId) || catalogId <= 0 || ids.includes(catalogId)) continue;
    ids.push(catalogId);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function monitoredState(event: ConjunctionRecord | null, hasScreeningCoverage = true): MonitoredState {
  if (!hasScreeningCoverage) return { label: 'Connector needed', tone: 'needs-data' };
  if (!event) return { label: 'Clear', tone: 'clear' };
  if (event.priority === 'review') return { label: 'Review', tone: 'review' };
  if (event.priority === 'watch') return { label: 'Watch', tone: 'watch' };
  if (event.priority === 'needs-data') return { label: 'Needs data', tone: 'needs-data' };
  return { label: 'Low', tone: 'low' };
}

export function priorityReason(event: ConjunctionRecord) {
  if (event.priority === 'review') return 'The published maximum probability crossed the review threshold.';
  if (event.priority === 'watch') return 'The published maximum probability entered the watch band.';
  if (event.priority === 'low') return 'The event remains below the watch threshold.';
  return 'The source is missing a usable probability field.';
}

export function highestFleetDebrisAlert(
  events: ConjunctionRecord[],
  fleetIds: number[],
  threatsById: Map<number, ThreatObject>,
) {
  const ranked = [...events].sort(comparePriority);
  const debrisEvents = ranked.filter((event) => {
    const protectedId = fleetIds.includes(event.primaryCatalogId)
      ? event.primaryCatalogId
      : fleetIds.includes(event.secondaryCatalogId)
        ? event.secondaryCatalogId
        : event.primaryCatalogId;
    const counterpartId = event.primaryCatalogId === protectedId
      ? event.secondaryCatalogId
      : event.primaryCatalogId;
    const counterpart = threatsById.get(counterpartId);
    return Boolean(counterpart && !isSatelliteObjectType(counterpart.objectType));
  });
  const namedDebrisEvent = debrisEvents.find((event) => {
    const protectedId = fleetIds.includes(event.primaryCatalogId) ? event.primaryCatalogId : event.secondaryCatalogId;
    const counterpartId = event.primaryCatalogId === protectedId ? event.secondaryCatalogId : event.primaryCatalogId;
    const counterpart = threatsById.get(counterpartId);
    return Boolean(counterpart && ['DEB', 'R/B'].includes(counterpart.objectType.toUpperCase()) && !/^UNKNOWN\b/i.test(counterpart.name));
  });
  return namedDebrisEvent ?? debrisEvents[0] ?? ranked[0] ?? null;
}
