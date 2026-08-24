import { describe, expect, it, vi } from 'vitest';

import {
  animateToTca,
  countDebrisBySize,
  DEBRIS_COLORS,
  isSatelliteObjectType,
  objectMarkerColor,
  orbitVisualStyle,
  SATELLITE_COLOR,
  tcaAnimationFrame,
  type AnimationScheduler,
} from './collision-visualization';
import type { DebrisSize, ThreatObject } from './types';

function threat(catalogId: number, objectType: string, size: DebrisSize): ThreatObject {
  return {
    catalogId,
    name: `Object ${catalogId}`,
    objectType,
    owner: 'TST',
    rcs: null,
    size,
    eventIds: [],
    protectedSatelliteIds: [],
    eventCount: 0,
    maximumProbability: null,
    minimumRangeKm: null,
    nextTca: null,
    record: null,
  };
}

function fakeScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const scheduler: AnimationScheduler = {
    now: () => 0,
    request: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  };
  return { scheduler, callbacks };
}

describe('collision visualization rules', () => {
  it('keeps payload markers red and size-colors only non-payload objects', () => {
    expect(isSatelliteObjectType('PAY')).toBe(true);
    expect(isSatelliteObjectType('payload')).toBe(true);
    expect(isSatelliteObjectType('DEB')).toBe(false);
    expect(objectMarkerColor('PAY', 'small')).toBe(SATELLITE_COLOR);
    expect(objectMarkerColor('DEB', 'small')).toBe(DEBRIS_COLORS.small);
    expect(objectMarkerColor('R/B', 'large')).toBe(DEBRIS_COLORS.large);
  });

  it('excludes payloads from the debris legend counts', () => {
    expect(countDebrisBySize([
      threat(1, 'PAY', 'large'),
      threat(2, 'DEB', 'small'),
      threat(3, 'R/B', 'large'),
      threat(4, 'UNK', 'unknown'),
    ])).toEqual({ small: 1, medium: 0, large: 1, unknown: 1 });
  });

  it('uses subdued red watchlist paths and a solid selected satellite path', () => {
    const watchlist = orbitVisualStyle('watchlist');
    const selected = orbitVisualStyle('selected-satellite');
    const paired = orbitVisualStyle('paired-object', DEBRIS_COLORS.medium);
    expect(watchlist.color).toContain('255,94,94');
    expect(selected.color).toBe(SATELLITE_COLOR);
    expect(selected.dashGap).toBe(0);
    expect(selected.stroke).toBeGreaterThan(watchlist.stroke);
    expect(paired.color).toBe(DEBRIS_COLORS.medium);
    expect(paired.dashGap).toBeGreaterThan(0);
  });
});

describe('TCA animation', () => {
  it('eases between the current time and TCA and completes exactly at the target', () => {
    expect(tcaAnimationFrame(1_000, 2_000, 900, 1_800)).toEqual({ value: 1_500, done: false });
    expect(tcaAnimationFrame(1_000, 2_000, 1_800, 1_800)).toEqual({ value: 2_000, done: true });
    expect(tcaAnimationFrame(2_000, 1_000, 900, 1_800)).toEqual({ value: 1_500, done: false });
  });

  it('cancels a scheduled transition without updating or completing', () => {
    const { scheduler, callbacks } = fakeScheduler();
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const cancel = animateToTca({ from: 0, to: 100, duration: 1_800, scheduler, onUpdate, onComplete });
    expect(callbacks.size).toBe(1);
    cancel();
    expect(callbacks.size).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('runs scheduled frames through completion', () => {
    const { scheduler, callbacks } = fakeScheduler();
    const updates: number[] = [];
    const onComplete = vi.fn();
    animateToTca({ from: 0, to: 100, duration: 1_800, scheduler, onUpdate: (value) => updates.push(value), onComplete });
    const first = [...callbacks.entries()][0];
    callbacks.delete(first[0]);
    first[1](900);
    const second = [...callbacks.entries()][0];
    callbacks.delete(second[0]);
    second[1](1_800);
    expect(updates).toEqual([50, 100]);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('jumps immediately when reduced motion removes the animation duration', () => {
    const { scheduler } = fakeScheduler();
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    animateToTca({ from: 0, to: 100, duration: 0, scheduler, onUpdate, onComplete });
    expect(onUpdate).toHaveBeenCalledWith(100);
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
