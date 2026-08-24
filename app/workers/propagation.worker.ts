/// <reference lib="webworker" />

import { propagateOmm } from '../lib/orbit';
import type { OmmRecord } from '../lib/types';

let catalogue: OmmRecord[] = [];

export function propagateCatalogue(objects: OmmRecord[], timestamp: number) {
  const date = new Date(timestamp);
  return objects.map((record) => propagateOmm(record, date)).filter((point) => point !== null);
}

const workerScope = typeof self === 'undefined' ? null : self;

if (workerScope) workerScope.onmessage = (event: MessageEvent<{ type: 'init'; objects: OmmRecord[] } | { type: 'propagate'; timestamp: number }>) => {
  if (event.data.type === 'init') {
    catalogue = event.data.objects;
    return;
  }

  const points = propagateCatalogue(catalogue, event.data.timestamp);
  workerScope.postMessage({ type: 'points', timestamp: event.data.timestamp, points });
};

export {};
