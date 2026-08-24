import type { DebrisSize, ThreatObject } from './types';

export const SATELLITE_COLOR = '#ff5e5e';

export const DEBRIS_COLORS: Record<DebrisSize, string> = {
  small: '#a979ff',
  medium: '#ffae45',
  large: '#ff5e5e',
  unknown: '#9aa7b0',
};

export type OrbitVisualRole = 'watchlist' | 'selected-satellite' | 'paired-object' | 'cpa-link';

export type OrbitVisualStyle = {
  color: string;
  stroke: number;
  dashLength: number;
  dashGap: number;
  dashAnimateTime: number;
};

export function isSatelliteObjectType(objectType?: string | null) {
  const normalized = objectType?.trim().toUpperCase();
  return normalized === 'PAY' || normalized === 'PAYLOAD';
}

export function objectMarkerColor(objectType: string | null | undefined, size: DebrisSize = 'unknown') {
  return isSatelliteObjectType(objectType) ? SATELLITE_COLOR : DEBRIS_COLORS[size];
}

export function countDebrisBySize(objects: ThreatObject[]) {
  const counts: Record<DebrisSize, number> = { small: 0, medium: 0, large: 0, unknown: 0 };
  for (const object of objects) {
    if (!isSatelliteObjectType(object.objectType)) counts[object.size] += 1;
  }
  return counts;
}

export function orbitVisualStyle(role: OrbitVisualRole, pairedColor = DEBRIS_COLORS.unknown): OrbitVisualStyle {
  if (role === 'selected-satellite') {
    return { color: SATELLITE_COLOR, stroke: 1.2, dashLength: 1, dashGap: 0, dashAnimateTime: 0 };
  }
  if (role === 'paired-object') {
    return { color: pairedColor, stroke: 1, dashLength: 0.055, dashGap: 0.025, dashAnimateTime: 2600 };
  }
  if (role === 'cpa-link') {
    return { color: '#f4f7f9', stroke: 0.7, dashLength: 0.025, dashGap: 0.015, dashAnimateTime: 900 };
  }
  return { color: 'rgba(255,94,94,0.28)', stroke: 0.34, dashLength: 0.035, dashGap: 0.03, dashAnimateTime: 7200 };
}

export function tcaAnimationFrame(from: number, to: number, elapsed: number, duration: number) {
  const progress = duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  return {
    value: from + (to - from) * eased,
    done: progress >= 1,
  };
}

export type AnimationScheduler = {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

export function animateToTca({
  from,
  to,
  duration,
  scheduler,
  onUpdate,
  onComplete,
}: {
  from: number;
  to: number;
  duration: number;
  scheduler: AnimationScheduler;
  onUpdate: (value: number) => void;
  onComplete: () => void;
}) {
  const startedAt = scheduler.now();
  let frameId: number | null = null;
  let cancelled = false;

  const tick: FrameRequestCallback = (timestamp) => {
    if (cancelled) return;
    const frame = tcaAnimationFrame(from, to, timestamp - startedAt, duration);
    onUpdate(frame.value);
    if (frame.done) {
      frameId = null;
      onComplete();
      return;
    }
    frameId = scheduler.request(tick);
  };

  if (duration <= 0) {
    onUpdate(to);
    onComplete();
  } else {
    frameId = scheduler.request(tick);
  }

  return () => {
    cancelled = true;
    if (frameId !== null) scheduler.cancel(frameId);
  };
}
