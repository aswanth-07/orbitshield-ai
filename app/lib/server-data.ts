import Papa from 'papaparse';

import activeSnapshot from '../data/active-catalog.snapshot.json';
import socratesSnapshot from '../data/socrates-fleet.snapshot.json';
import threatSnapshot from '../data/threat-catalog.snapshot.json';
import { INDIA_EO_IDS } from './fleet';
import { enrichConjunction } from './screening';
import type {
  CatalogResponse,
  ConjunctionRecord,
  ConjunctionResponse,
  DebrisSize,
  OmmRecord,
  SatcatRecord,
  SocratesRun,
  ThreatObject,
  ThreatResponse,
} from './types';

const USER_AGENT = 'OrbitShield-AI/1.0 college prototype (github.com/aswanth-07/orbitshield-ai)';
const ACTIVE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON';
const CATNR_URL = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=JSON&CATNR=';
const SOCRATES_DIRECTORY_URL = 'https://celestrak.org/SOCRATES/jsonDir.php';
const TWO_HOURS = 2 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const SOCRATES_CYCLE = 10.5 * 60 * 60 * 1000;
const EDGE_CACHE_ORIGIN = 'https://orbitshield-cache.local/';

type CacheEntry<T> = { value: T; expiresAt: number };
type SnapshotCatalog = Omit<CatalogResponse, 'status' | 'message'> & { upstream?: string };
type SnapshotSocrates = {
  source: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  run: SocratesRun;
  events: Array<Omit<ConjunctionRecord, 'id' | 'priority' | 'reasons' | 'flags'>>;
};
type SnapshotThreatCatalogue = {
  source: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  count: number;
  positionedCount: number;
  objects: Array<{
    catalogId: number;
    record: OmmRecord | null;
    satcat: SatcatRecord | null;
  }>;
};
type ThreatAggregate = {
  name: string;
  eventIds: string[];
  protectedSatelliteIds: Set<number>;
  maximumProbability: number | null;
  minimumRangeKm: number | null;
  nextTca: string | null;
};

let activeCache: CacheEntry<CatalogResponse> | null = null;
let conjunctionCache: CacheEntry<ConjunctionResponse> | null = null;
let threatCache: CacheEntry<ThreatResponse> | null = null;
const selectedCache = new Map<string, CacheEntry<CatalogResponse>>();

function cloudflareCache(): Cache | null {
  const cacheStorage = (globalThis as typeof globalThis & {
    caches?: CacheStorage & { default?: Cache };
  }).caches;
  return cacheStorage?.default ?? null;
}

async function readEdgeCache<T>(key: string): Promise<T | null> {
  const cache = cloudflareCache();
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(`${EDGE_CACHE_ORIGIN}${encodeURIComponent(key)}`));
    return response ? await response.json() as T : null;
  } catch {
    return null;
  }
}

async function writeEdgeCache(key: string, value: unknown, ttlMs: number) {
  const cache = cloudflareCache();
  if (!cache) return;
  try {
    await cache.put(
      new Request(`${EDGE_CACHE_ORIGIN}${encodeURIComponent(key)}`),
      new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${Math.floor(ttlMs / 1000)}`,
        },
      }),
    );
  } catch {
    // Cloudflare Cache API is opportunistic; local and bundled caches remain valid.
  }
}

function markEdgeCached<T extends CatalogResponse | ConjunctionResponse>(value: T): T {
  return {
    ...value,
    status: value.status === 'unavailable' ? 'unavailable' : 'cached',
    message: value.message ?? 'Served from the timestamped Cloudflare edge cache.',
  };
}

function fetchOptions(): RequestInit {
  return {
    headers: {
      Accept: 'application/json,text/csv;q=0.9,*/*;q=0.8',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  };
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeOmm(records: unknown): OmmRecord[] {
  if (!Array.isArray(records)) return [];
  return records.filter((item): item is OmmRecord => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Partial<OmmRecord>;
    return Boolean(record.OBJECT_NAME && record.EPOCH && Number(record.NORAD_CAT_ID));
  });
}

function fallbackCatalog(ids?: number[]): CatalogResponse {
  const snapshot = activeSnapshot as SnapshotCatalog;
  const objects = ids?.length
    ? snapshot.objects.filter((record) => ids.includes(Number(record.NORAD_CAT_ID)))
    : snapshot.objects;
  return {
    status: objects.length ? 'cached' : 'unavailable',
    source: 'Bundled active-catalogue snapshot',
    upstream: snapshot.upstream ?? ACTIVE_URL,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    fetchedAt: snapshot.fetchedAt,
    count: objects.length,
    objects,
    message: objects.length
      ? 'Live CelesTrak data is unavailable; the timestamped offline snapshot is in use.'
      : 'No usable orbit elements are available for this object.',
  };
}

async function fetchCelesTrakJson(url: string) {
  const response = await fetch(url, fetchOptions());
  if (!response.ok) throw new Error(`CelesTrak returned HTTP ${response.status}`);
  return response.json();
}

export async function getCatalog(ids?: number[]): Promise<CatalogResponse> {
  const cleanIds = ids?.filter((id) => Number.isInteger(id) && id > 0).slice(0, 20) ?? [];
  const key = cleanIds.slice().sort((a, b) => a - b).join(',');
  const now = Date.now();
  const cached = cleanIds.length ? selectedCache.get(key) : activeCache;
  if (cached && cached.expiresAt > now) return cached.value;

  const edgeKey = cleanIds.length ? `catalog-selected-${key}` : 'catalog-active';
  const edgeValue = await readEdgeCache<CatalogResponse>(edgeKey);
  if (edgeValue) {
    const value = markEdgeCached(edgeValue);
    const entry = { value, expiresAt: now + TWO_HOURS };
    if (cleanIds.length) selectedCache.set(key, entry);
    else activeCache = entry;
    return value;
  }

  try {
    const records = cleanIds.length
      ? normalizeOmm((await Promise.all(cleanIds.map((id) => fetchCelesTrakJson(`${CATNR_URL}${id}`)))).flat())
      : normalizeOmm(await fetchCelesTrakJson(ACTIVE_URL));
    if (!records.length) throw new Error('CelesTrak returned no usable OMM records');
    const value: CatalogResponse = {
      status: 'current',
      source: 'CelesTrak GP OMM JSON',
      upstream: cleanIds.length ? `${CATNR_URL}${key}` : ACTIVE_URL,
      sourceUpdatedAt: records.reduce<string | null>((latest, item) => {
        if (!latest || new Date(item.EPOCH) > new Date(latest)) return item.EPOCH;
        return latest;
      }, null),
      fetchedAt: nowIso(),
      count: records.length,
      objects: records,
    };
    const entry = { value, expiresAt: now + TWO_HOURS };
    if (cleanIds.length) selectedCache.set(key, entry);
    else activeCache = entry;
    await writeEdgeCache(edgeKey, value, TWO_HOURS);
    return value;
  } catch (error) {
    const value = fallbackCatalog(cleanIds);
    value.message = `${value.message} ${error instanceof Error ? error.message : 'Upstream request failed.'}`;
    const entry = { value, expiresAt: now + TWO_HOURS };
    if (cleanIds.length) selectedCache.set(key, entry);
    else activeCache = entry;
    return value;
  }
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSocratesRows(rows: Record<string, string>[], now = new Date()): ConjunctionRecord[] {
  return rows.flatMap((row) => {
    const primaryCatalogId = Number(row.NORAD_CAT_ID_1);
    const secondaryCatalogId = Number(row.NORAD_CAT_ID_2);
    if (!Number.isInteger(primaryCatalogId) || !Number.isInteger(secondaryCatalogId)) return [];
    if (!INDIA_EO_IDS.has(primaryCatalogId) && !INDIA_EO_IDS.has(secondaryCatalogId)) return [];
    const rawTca = row.TCA?.trim();
    if (!rawTca) return [];
    const tca = /Z$/.test(rawTca) ? rawTca : `${rawTca.replace(' ', 'T')}Z`;
    return [enrichConjunction({
      primaryCatalogId,
      primaryName: row.OBJECT_NAME_1?.trim() || `NORAD ${primaryCatalogId}`,
      primaryElementAgeDays: parseOptionalNumber(row.DSE_1),
      secondaryCatalogId,
      secondaryName: row.OBJECT_NAME_2?.trim() || `NORAD ${secondaryCatalogId}`,
      secondaryElementAgeDays: parseOptionalNumber(row.DSE_2),
      tca,
      rangeKm: parseOptionalNumber(row.TCA_RANGE),
      relativeSpeedKmS: parseOptionalNumber(row.TCA_RELATIVE_SPEED),
      maximumProbability: parseOptionalNumber(row.MAX_PROB),
      dilutionKm: parseOptionalNumber(row.DILUTION),
    }, now)];
  });
}

export function parseSocratesCsv(csv: string, now = new Date()) {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return normalizeSocratesRows(result.data, now);
}

function fallbackConjunctions(now = new Date()): ConjunctionResponse {
  const snapshot = socratesSnapshot as SnapshotSocrates;
  const events = snapshot.events.map((event) => enrichConjunction(event, now));
  return {
    status: events.length ? 'cached' : 'unavailable',
    source: 'Bundled SOCRATES fleet snapshot',
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    fetchedAt: snapshot.fetchedAt,
    run: snapshot.run,
    events,
    message: 'The latest prepared SOCRATES run is available for offline judging.',
  };
}

export async function getConjunctions(): Promise<ConjunctionResponse> {
  const now = Date.now();
  if (conjunctionCache && conjunctionCache.expiresAt > now) return conjunctionCache.value;

  const edgeValue = await readEdgeCache<ConjunctionResponse>('socrates-current-run');
  if (edgeValue) {
    const value = markEdgeCached(edgeValue);
    conjunctionCache = { value, expiresAt: now + SOCRATES_CYCLE };
    return value;
  }

  try {
    const directoryResponse = await fetch(SOCRATES_DIRECTORY_URL, fetchOptions());
    if (!directoryResponse.ok) throw new Error(`SOCRATES directory returned HTTP ${directoryResponse.status}`);
    const directoryJson = await directoryResponse.json() as { FILE_NAME?: string; FILE_MTIME?: string } | Array<{ FILE_NAME?: string; FILE_MTIME?: string }>;
    const directory = Array.isArray(directoryJson) ? directoryJson[0] : directoryJson;
    if (!directory?.FILE_NAME) throw new Error('SOCRATES directory did not name a run file');
    const source = `https://celestrak.org/SOCRATES/${directory.FILE_NAME}`;
    const runResponse = await fetch(source, { ...fetchOptions(), headers: { ...fetchOptions().headers, Accept: 'application/octet-stream,text/csv;q=0.9,*/*;q=0.8' } });
    if (!runResponse.ok) throw new Error(`SOCRATES run returned HTTP ${runResponse.status}`);
    const csv = await runResponse.text();
    const events = parseSocratesCsv(csv, new Date());
    if (!events.length) throw new Error('SOCRATES run contained no usable India-fleet rows');
    const fallback = socratesSnapshot as SnapshotSocrates;
    const value: ConjunctionResponse = {
      status: 'current',
      source: 'CelesTrak SOCRATES current run',
      sourceUpdatedAt: directory.FILE_MTIME ?? null,
      fetchedAt: nowIso(),
      run: {
        ...fallback.run,
        currentAsOf: directory.FILE_MTIME ?? fallback.run.currentAsOf,
        conjunctionCount: Papa.parse(csv, { header: true, skipEmptyLines: true }).data.length,
      },
      events,
    };
    conjunctionCache = { value, expiresAt: now + SOCRATES_CYCLE };
    await writeEdgeCache('socrates-current-run', value, SOCRATES_CYCLE);
    return value;
  } catch (error) {
    const value = fallbackConjunctions(new Date());
    value.message = `${value.message} ${error instanceof Error ? error.message : 'Upstream request failed.'}`;
    conjunctionCache = { value, expiresAt: now + ONE_HOUR };
    return value;
  }
}

export function debrisSizeFromRcs(rcs: number | null): DebrisSize {
  if (rcs === null || !Number.isFinite(rcs) || rcs < 0) return 'unknown';
  if (rcs < 0.1) return 'small';
  if (rcs <= 1) return 'medium';
  return 'large';
}

function aggregateThreats(conjunctions: ConjunctionResponse) {
  const aggregates = new Map<number, ThreatAggregate>();
  const now = Date.now();
  for (const event of conjunctions.events) {
    const tca = new Date(event.tca).getTime();
    if (!Number.isFinite(tca) || tca <= now) continue;
    const primaryProtected = INDIA_EO_IDS.has(event.primaryCatalogId);
    const secondaryProtected = INDIA_EO_IDS.has(event.secondaryCatalogId);
    if (primaryProtected === secondaryProtected) continue;
    const catalogId = primaryProtected ? event.secondaryCatalogId : event.primaryCatalogId;
    const protectedCatalogId = primaryProtected ? event.primaryCatalogId : event.secondaryCatalogId;
    const name = primaryProtected ? event.secondaryName : event.primaryName;
    const existing = aggregates.get(catalogId) ?? {
      name,
      eventIds: [],
      protectedSatelliteIds: new Set<number>(),
      maximumProbability: null,
      minimumRangeKm: null,
      nextTca: null,
    };
    existing.eventIds.push(event.id);
    existing.protectedSatelliteIds.add(protectedCatalogId);
    if (event.maximumProbability !== null && (existing.maximumProbability === null || event.maximumProbability > existing.maximumProbability)) {
      existing.maximumProbability = event.maximumProbability;
    }
    if (event.rangeKm !== null && (existing.minimumRangeKm === null || event.rangeKm < existing.minimumRangeKm)) {
      existing.minimumRangeKm = event.rangeKm;
    }
    if (!existing.nextTca || new Date(event.tca) < new Date(existing.nextTca)) existing.nextTca = event.tca;
    aggregates.set(catalogId, existing);
  }
  return aggregates;
}

function buildThreatObjects(
  aggregates: Map<number, ThreatAggregate>,
  snapshotById: Map<number, SnapshotThreatCatalogue['objects'][number]>,
  records: Map<number, OmmRecord | null>,
) {
  return [...aggregates].map(([catalogId, aggregate]): ThreatObject => {
    const snapshotObject = snapshotById.get(catalogId);
    const satcat = snapshotObject?.satcat ?? null;
    const rcs = parseOptionalNumber(satcat?.RCS);
    return {
      catalogId,
      name: (satcat?.OBJECT_NAME || aggregate.name).replace(/\s*\[[+?−-]\]\s*$/, '').trim(),
      objectType: satcat?.OBJECT_TYPE || (/DEB/i.test(aggregate.name) ? 'DEB' : /R\/B/i.test(aggregate.name) ? 'R/B' : 'UNK'),
      owner: satcat?.OWNER || 'Unknown',
      rcs,
      size: debrisSizeFromRcs(rcs),
      eventIds: aggregate.eventIds,
      protectedSatelliteIds: [...aggregate.protectedSatelliteIds],
      eventCount: aggregate.eventIds.length,
      maximumProbability: aggregate.maximumProbability,
      minimumRangeKm: aggregate.minimumRangeKm,
      nextTca: aggregate.nextTca,
      record: records.get(catalogId) ?? null,
    };
  }).sort((a, b) => (b.maximumProbability ?? -1) - (a.maximumProbability ?? -1));
}

export function getBundledScreening() {
  const conjunctions = fallbackConjunctions(new Date());
  const snapshot = threatSnapshot as SnapshotThreatCatalogue;
  const snapshotById = new Map(snapshot.objects.map((item) => [item.catalogId, item]));
  const aggregates = aggregateThreats(conjunctions);
  const records = new Map(snapshot.objects.map((item) => [item.catalogId, item.record]));
  const objects = buildThreatObjects(aggregates, snapshotById, records);
  const threats: ThreatResponse = {
    status: 'cached',
    source: `${conjunctions.source} + ${snapshot.source}`,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    fetchedAt: snapshot.fetchedAt,
    count: objects.length,
    positionedCount: objects.filter((item) => item.record).length,
    objects,
    message: 'Fast timestamped snapshot loaded while the live CelesTrak refresh runs.',
  };
  return { conjunctions, threats, refreshedAt: snapshot.fetchedAt };
}

export async function getThreats(): Promise<ThreatResponse> {
  const now = Date.now();
  if (threatCache && threatCache.expiresAt > now) return threatCache.value;
  const edgeValue = await readEdgeCache<ThreatResponse>('threat-overlay-snapshot-v2');
  if (edgeValue) {
    const cachedValue: ThreatResponse = {
      ...edgeValue,
      status: 'cached',
      message: 'Cached threat geometry is shown while the selected conjunction pair remains available for an on-demand element refresh.',
    };
    threatCache = { value: cachedValue, expiresAt: now + TWO_HOURS };
    return cachedValue;
  }

  const conjunctions = await getConjunctions();
  const snapshot = threatSnapshot as SnapshotThreatCatalogue;
  const snapshotById = new Map(snapshot.objects.map((item) => [item.catalogId, item]));
  const aggregates = aggregateThreats(conjunctions);

  const threatIds = [...aggregates.keys()];
  const fallbackRecords = new Map(threatIds.map((catalogId) => [catalogId, snapshotById.get(catalogId)?.record ?? null]));
  const objects = buildThreatObjects(aggregates, snapshotById, fallbackRecords);

  const value: ThreatResponse = {
    status: 'cached',
    source: `${conjunctions.source} + timestamped CelesTrak GP/SATCAT threat snapshot`,
    sourceUpdatedAt: conjunctions.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
    fetchedAt: nowIso(),
    count: objects.length,
    positionedCount: objects.filter((item) => item.record).length,
    objects,
    message: 'The overview uses bundled, timestamped threat geometry. OrbitShield fetches only the selected pair on demand to respect CelesTrak usage limits.',
  };
  threatCache = { value, expiresAt: now + TWO_HOURS };
  await writeEdgeCache('threat-overlay-snapshot-v2', value, TWO_HOURS);
  return value;
}
