import { isSatelliteObjectType } from './collision-visualization';
import { comparePriority } from './screening';
import type { ConjunctionRecord, ThreatObject } from './types';

export type MonitoredState = {
  label: 'Review' | 'Watch' | 'Low' | 'Needs data' | 'Clear';
  tone: 'review' | 'watch' | 'low' | 'needs-data' | 'clear';
};

export function eventForSatellite(events: ConjunctionRecord[], catalogId: number) {
  return events
    .filter((event) => event.primaryCatalogId === catalogId || event.secondaryCatalogId === catalogId)
    .sort(comparePriority)[0] ?? null;
}

export function monitoredState(event: ConjunctionRecord | null): MonitoredState {
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
