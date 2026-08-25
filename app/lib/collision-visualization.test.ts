import { describe, expect, it, vi } from 'vitest';

import {
  animateToTca,
  animateTcaReplay,
  CATALOG_SATELLITE_COLOR,
  countDebrisBySize,
  DEBRIS_COLORS,
  isSatelliteObjectType,
  MONITORED_SATELLITE_COLOR,
  objectMarkerColor,
  orbitVisualStyle,
  RISK_ORBIT_COLOR,
  SATELLITE_COLOR,
  TCA_REPLAY_DURATION_MS,
  TCA_REPLAY_WINDOW_MS,
  tcaAnimationFrame,
  tcaReplayFrame,
  tcaReplayStart,
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
  it('keeps catalogue payload markers green and size-colors only non-payload objects', () => {
    expect(CATALOG_SATELLITE_COLOR).toBe('#64ff88');
    expect(MONITORED_SATELLITE_COLOR).toBe('#35d7ff');
    expect(RISK_ORBIT_COLOR).toBe('#ff4452');
    expect(SATELLITE_COLOR).toBe('#64ff88');
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

  it('uses blue monitored paths and red solid and dashed risk paths', () => {
    const watchlist = orbitVisualStyle('watchlist');
    const selected = orbitVisualStyle('selected-satellite');
    const protectedRisk = orbitVisualStyle('protected-risk');
    const paired = orbitVisualStyle('paired-object', DEBRIS_COLORS.medium);
    const maneuver = orbitVisualStyle('maneuver-study');
    const depthGuide = orbitVisualStyle('depth-guide', DEBRIS_COLORS.medium);
    expect(watchlist.color).toContain('53,215,255');
    expect(watchlist.stroke).toBeGreaterThan(0.5);
    expect(watchlist.dashGap).toBe(0);
    expect(selected.color).toBe(MONITORED_SATELLITE_COLOR);
    expect(selected.dashGap).toBe(0);
    expect(selected.stroke).toBeGreaterThan(watchlist.stroke);
    expect(protectedRisk.color).toBe(RISK_ORBIT_COLOR);
    expect(protectedRisk.dashGap).toBe(0);
    expect(paired.color).toBe(RISK_ORBIT_COLOR);
    expect(paired.dashGap).toBeGreaterThan(0);
    expect(maneuver.color).toBe('#50d9b3');
    expect(maneuver.dashGap).toBeGreaterThan(0);
    expect(depthGuide.color).toBe(DEBRIS_COLORS.medium);
    expect(depthGuide.dashGap).toBeGreaterThan(0);
  });
});

describe('TCA animation', () => {
  it('uses a fixed twenty-minute cinematic window when the event is farther away', () => {
    const tca = 2_000_000;
    expect(tcaReplayStart(0, tca)).toBe(tca - TCA_REPLAY_WINDOW_MS);
    expect(tcaReplayStart(tca - 60_000, tca)).toBe(tca - 60_000);
    expect(tcaReplayStart(tca + 1, tca)).toBe(tca - TCA_REPLAY_WINDOW_MS);
  });

  it('moves monotonically through follow, acquire, and encounter phases', () => {
    const from = 0;
    const tca = TCA_REPLAY_WINDOW_MS;
    const follow = tcaReplayFrame(from, tca, TCA_REPLAY_DURATION_MS * 0.5);
    const acquire = tcaReplayFrame(from, tca, TCA_REPLAY_DURATION_MS * 0.65);
    const encounter = tcaReplayFrame(from, tca, TCA_REPLAY_DURATION_MS);
    expect(follow.phase).toBe('follow');
    expect(acquire.phase).toBe('acquire');
    expect(encounter.phase).toBe('encounter');
    expect(follow.simulationTime).toBeLessThan(acquire.simulationTime);
    expect(acquire.simulationTime).toBeLessThan(encounter.simulationTime);
    expect(encounter).toMatchObject({ simulationTime: tca, progress: 1, done: true });
    expect(encounter.displayedSpeed).toBeCloseTo(184.615, 2);
  });

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

  it('emits replay phases and completes at TCA', () => {
    const { scheduler, callbacks } = fakeScheduler();
    const frames: Array<{ phase: string; simulationTime: number }> = [];
    const onComplete = vi.fn();
    animateTcaReplay({
      from: 0,
      tca: 100,
      duration: 100,
      scheduler,
      onUpdate: (frame) => frames.push(frame),
      onComplete,
    });
    for (const timestamp of [50, 65, 100]) {
      const entry = [...callbacks.entries()][0];
      callbacks.delete(entry[0]);
      entry[1](timestamp);
    }
    expect(frames.map((frame) => frame.phase)).toEqual(['follow', 'acquire', 'encounter']);
    expect(frames.at(-1)?.simulationTime).toBe(100);
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
