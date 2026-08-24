/// <reference lib="webworker" />

import { prepareOmm, propagatePreparedOmm, type PreparedOmm } from '../lib/orbit';
import type { OmmRecord } from '../lib/types';

let catalogue: PreparedOmm[] = [];

export function propagateCatalogue(objects: OmmRecord[], timestamp: number) {
  const date = new Date(timestamp);
  return objects
    .map((record) => prepareOmm(record))
    .filter((record): record is PreparedOmm => Boolean(record))
    .map((record) => propagatePreparedOmm(record, date))
    .filter((point) => point !== null);
}

const workerScope = typeof self === 'undefined' ? null : self;

if (workerScope) workerScope.onmessage = (event: MessageEvent<{ type: 'init'; objects: OmmRecord[] } | { type: 'propagate'; timestamp: number }>) => {
  if (event.data.type === 'init') {
    catalogue = event.data.objects
      .map((record) => prepareOmm(record))
      .filter((record): record is PreparedOmm => Boolean(record));
    return;
  }

  const date = new Date(event.data.timestamp);
  const points = catalogue
    .map((record) => propagatePreparedOmm(record, date))
    .filter((point) => point !== null);
  workerScope.postMessage({ type: 'points', timestamp: event.data.timestamp, points });
};

export {};
