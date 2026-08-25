import type { DebrisSize, ThreatObject } from './types';

export const CATALOG_SATELLITE_COLOR = '#64ff88';
export const MONITORED_SATELLITE_COLOR = '#35d7ff';
export const RISK_ORBIT_COLOR = '#ff4452';
export const SATELLITE_COLOR = CATALOG_SATELLITE_COLOR;

export const DEBRIS_COLORS: Record<DebrisSize, string> = {
  small: '#a979ff',
  medium: '#ffae45',
  large: '#ff5e5e',
  unknown: '#9aa7b0',
};

export type OrbitVisualRole = 'watchlist' | 'selected-satellite' | 'protected-risk' | 'paired-object' | 'maneuver-study' | 'cpa-link' | 'depth-guide';

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
    return { color: MONITORED_SATELLITE_COLOR, stroke: 1.2, dashLength: 1, dashGap: 0, dashAnimateTime: 0 };
  }
  if (role === 'protected-risk') {
    return { color: RISK_ORBIT_COLOR, stroke: 1.35, dashLength: 1, dashGap: 0, dashAnimateTime: 0 };
  }
  if (role === 'paired-object') {
    return { color: RISK_ORBIT_COLOR, stroke: 1.15, dashLength: 0.055, dashGap: 0.025, dashAnimateTime: 1800 };
  }
  if (role === 'maneuver-study') {
    return { color: '#50d9b3', stroke: 1.25, dashLength: 0.12, dashGap: 0.035, dashAnimateTime: 1_400 };
  }
  if (role === 'cpa-link') {
    return { color: '#ff7983', stroke: 0.7, dashLength: 0.025, dashGap: 0.015, dashAnimateTime: 900 };
  }
  if (role === 'depth-guide') {
    return { color: pairedColor, stroke: 0.42, dashLength: 0.018, dashGap: 0.015, dashAnimateTime: 0 };
  }
  return { color: 'rgba(53,215,255,0.72)', stroke: 0.7, dashLength: 1, dashGap: 0, dashAnimateTime: 0 };
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

export type TcaReplayPhase = 'follow' | 'acquire' | 'encounter';

export type TcaReplayFrame = {
  simulationTime: number;
  progress: number;
  phase: TcaReplayPhase;
  displayedSpeed: number;
  done: boolean;
};

export const TCA_REPLAY_WINDOW_MS = 20 * 60_000;
export const TCA_REPLAY_DURATION_MS = 6_500;

export function tcaReplayStart(current: number, tca: number) {
  const windowStart = tca - TCA_REPLAY_WINDOW_MS;
  return current >= windowStart && current < tca ? current : windowStart;
}

export function tcaReplayFrame(from: number, tca: number, elapsed: number, duration = TCA_REPLAY_DURATION_MS): TcaReplayFrame {
  const frame = tcaAnimationFrame(from, tca, elapsed, duration);
  const total = Math.max(0, tca - from);
  const progress = total === 0 ? 1 : Math.min(1, Math.max(0, (frame.value - from) / total));
  return {
    simulationTime: frame.value,
    progress,
    phase: progress < 0.72 ? 'follow' : progress < 0.94 ? 'acquire' : 'encounter',
    displayedSpeed: duration <= 0 ? 0 : total / duration,
    done: frame.done,
  };
}

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

export function animateTcaReplay({
  from,
  tca,
  duration = TCA_REPLAY_DURATION_MS,
  scheduler,
  onUpdate,
  onComplete,
}: {
  from: number;
  tca: number;
  duration?: number;
  scheduler: AnimationScheduler;
  onUpdate: (frame: TcaReplayFrame) => void;
  onComplete: () => void;
}) {
  const startedAt = scheduler.now();
  let frameId: number | null = null;
  let cancelled = false;

  const tick: FrameRequestCallback = (timestamp) => {
    if (cancelled) return;
    const frame = tcaReplayFrame(from, tca, timestamp - startedAt, duration);
    onUpdate(frame);
    if (frame.done) {
      frameId = null;
      onComplete();
      return;
    }
    frameId = scheduler.request(tick);
  };

  if (duration <= 0) {
    onUpdate(tcaReplayFrame(from, tca, duration, duration));
    onComplete();
  } else {
    frameId = scheduler.request(tick);
  }

  return () => {
    cancelled = true;
    if (frameId !== null) scheduler.cancel(frameId);
  };
}
