import Papa from 'papaparse';

import activeSnapshot from '../data/active-catalog.snapshot.json';
import socratesSnapshot from '../data/socrates-fleet.snapshot.json';
import { INDIA_EO_IDS } from './fleet';
import { enrichConjunction } from './screening';
import type {
  CatalogResponse,
  ConjunctionRecord,
  ConjunctionResponse,
  OmmRecord,
  SocratesRun,
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

let activeCache: CacheEntry<CatalogResponse> | null = null;
let conjunctionCache: CacheEntry<ConjunctionResponse> | null = null;
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

function finite(value: unknown): number | null {
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
      primaryElementAgeDays: finite(row.DSE_1),
      secondaryCatalogId,
      secondaryName: row.OBJECT_NAME_2?.trim() || `NORAD ${secondaryCatalogId}`,
      secondaryElementAgeDays: finite(row.DSE_2),
      tca,
      rangeKm: finite(row.TCA_RANGE),
      relativeSpeedKmS: finite(row.TCA_RELATIVE_SPEED),
      maximumProbability: finite(row.MAX_PROB),
      dilutionKm: finite(row.DILUTION),
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
    const runResponse = await fetch(source, { ...fetchOptions(), headers: { ...fetchOptions().headers, Accept: 'text/csv' } });
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
