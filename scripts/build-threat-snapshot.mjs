import { readFile, writeFile } from 'node:fs/promises';

import Papa from 'papaparse';

const ROOT = new URL('../', import.meta.url);
const SOCRATES_PATH = new URL('app/data/socrates-fleet.snapshot.json', ROOT);
const OUTPUT_PATH = new URL('app/data/threat-catalog.snapshot.json', ROOT);
const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';
const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=JSON&CATNR=';
const USER_AGENT = 'OrbitShield-AI/1.0 college prototype (github.com/aswanth-07/orbitshield-ai)';
const FLEET_IDS = new Set([41877, 44804, 44233, 54361, 43111, 37387]);

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchOmm(catalogId) {
  try {
    const response = await fetch(`${GP_URL}${catalogId}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    const payload = await response.json();
    const record = Array.isArray(payload) ? payload[0] : payload;
    return record?.EPOCH ? record : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const socrates = JSON.parse(await readFile(SOCRATES_PATH, 'utf8'));
const threatIds = [...new Set(socrates.events.flatMap((event) => [
  FLEET_IDS.has(Number(event.primaryCatalogId)) ? null : Number(event.primaryCatalogId),
  FLEET_IDS.has(Number(event.secondaryCatalogId)) ? null : Number(event.secondaryCatalogId),
]).filter(Boolean))].sort((a, b) => a - b);

const satcatCsv = await fetchText(SATCAT_URL);
const satcatRows = Papa.parse(satcatCsv, { header: true, skipEmptyLines: true, dynamicTyping: true }).data;
const wanted = new Set(threatIds);
const satcatById = new Map(satcatRows
  .filter((row) => wanted.has(Number(row.NORAD_CAT_ID)))
  .map((row) => [Number(row.NORAD_CAT_ID), row]));
const ommRecords = await mapWithConcurrency(threatIds, 6, fetchOmm);

const objects = threatIds.map((catalogId, index) => ({
  catalogId,
  record: ommRecords[index],
  satcat: satcatById.get(catalogId) ?? null,
}));

const output = {
  source: 'CelesTrak GP OMM JSON + SATCAT CSV',
  upstream: [GP_URL, SATCAT_URL],
  sourceUpdatedAt: socrates.sourceUpdatedAt,
  fetchedAt: new Date().toISOString(),
  count: objects.length,
  positionedCount: objects.filter((item) => item.record).length,
  objects,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
console.log(`Wrote ${output.count} threats (${output.positionedCount} with public GP elements) to ${OUTPUT_PATH.pathname}`);
