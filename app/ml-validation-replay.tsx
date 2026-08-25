'use client';

import { ArrowLeft, RotateCcw, Satellite, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import streamFixture from './data/live-cdm-stream.json';
import type { LiveCdmMessage } from './lib/live-model';

const stream = streamFixture as { eventId: number; messages: LiveCdmMessage[]; expectedScores: number[] };
const evidence = stream.messages.at(-1)!;
const DURATION_MS = 6_500;
const APPROACH_SECONDS = 20;

type Vector = { r: number; t: number; n: number };

function numeric(message: LiveCdmMessage, key: string) {
  const value = message[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const tcaVector: Vector = {
  r: numeric(evidence, 'relative_position_r'),
  t: numeric(evidence, 'relative_position_t'),
  n: numeric(evidence, 'relative_position_n'),
};
const relativeVelocity: Vector = {
  r: numeric(evidence, 'relative_velocity_r'),
  t: numeric(evidence, 'relative_velocity_t'),
  n: numeric(evidence, 'relative_velocity_n'),
};

function vectorAt(secondsToTca: number): Vector {
  return {
    r: tcaVector.r - relativeVelocity.r * secondsToTca,
    t: tcaVector.t - relativeVelocity.t * secondsToTca,
    n: tcaVector.n - relativeVelocity.n * secondsToTca,
  };
}

function magnitude(vector: Vector) {
  return Math.hypot(vector.r, vector.t, vector.n);
}

const missDistance = magnitude(tcaVector);
const startDistance = magnitude(vectorAt(APPROACH_SECONDS));
const relativeSpeed = magnitude(relativeVelocity);

function scenePosition(vector: Vector) {
  const planar = Math.max(1, Math.hypot(vector.r, vector.t));
  const distance = Math.max(missDistance, magnitude(vector));
  const range = Math.max(1, Math.log10(startDistance / Math.max(1, missDistance)));
  const radialScale = 0.1 + 0.78 * Math.min(1, Math.log10(distance / Math.max(1, missDistance)) / range);
  return {
    x: 50 + vector.t / planar * radialScale * 45,
    y: 50 - vector.r / planar * radialScale * 45,
  };
}

export default function MlValidationReplay({ onBack }: { onBack: () => void }) {
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(true);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const lastPaintRef = useRef(0);

  const begin = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    setProgress(0);
    setRunning(true);
    startedAtRef.current = performance.now();
    lastPaintRef.current = 0;

    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAtRef.current) / DURATION_MS);
      if (now - lastPaintRef.current >= 32 || next === 1) {
        lastPaintRef.current = now;
        setProgress(next);
      }
      if (next < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setRunning(false);
      }
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(begin, 120);
    return () => {
      window.clearTimeout(timer);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [begin]);

  const secondsToTca = APPROACH_SECONDS * (1 - progress);
  const currentVector = vectorAt(secondsToTca);
  const currentPosition = scenePosition(currentVector);
  const tcaPosition = scenePosition(tcaVector);
  const currentDistance = magnitude(currentVector);
  const modelScore = stream.expectedScores.at(-1) ?? 0;
  const trail = useMemo(() => Array.from({ length: 64 }, (_, index) => {
    const seconds = APPROACH_SECONDS * (1 - index / 63);
    return scenePosition(vectorAt(seconds));
  }).map((point) => `${point.x},${point.y}`).join(' '), []);

  return <div className="ml-tca-replay">
    <div className="ml-tca-replay-head">
      <button onClick={onBack}><ArrowLeft size={14} /> Globe</button>
      <span><ShieldAlert size={13} /> ML ELEVATED · ESA MISSION 1</span>
      <b>EVENT {stream.eventId} · HELD OUT</b>
    </div>

    <div className="ml-rtn-scene" role="img" aria-label="Magnified R T N replay of the model validation encounter approaching its predicted closest point">
      <div className="ml-rtn-grid" />
      <span className="ml-axis r">+R RADIAL</span>
      <span className="ml-axis t">+T ALONG-TRACK</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={trail} /></svg>
      <span className="ml-protected"><Satellite size={19} /><b>ESA MISSION 1</b><small>protected satellite</small></span>
      <span className="ml-tca-ring" style={{ left: `${tcaPosition.x}%`, top: `${tcaPosition.y}%` }}><i /><b>{missDistance.toFixed(0)} m TCA</b></span>
      <span className="ml-encounter-object" style={{ left: `${currentPosition.x}%`, top: `${currentPosition.y}%` }}><i /><b>9051-C</b><small>{currentDistance >= 1_000 ? `${(currentDistance / 1_000).toFixed(1)} km` : `${currentDistance.toFixed(0)} m`}</small></span>
      <div className="ml-depth-readout"><span>N DEPTH</span><b>{currentVector.n >= 0 ? '+' : '−'}{Math.abs(currentVector.n / 1_000).toFixed(2)} km</b></div>
      <div className="ml-scale-note">Magnified R–T–N view · logarithmic distance scale · CDM linear relative-motion replay</div>
    </div>

    <div className="ml-tca-readout">
      <span><small>Replay time</small><strong>{running ? `T−${secondsToTca.toFixed(2)} s` : 'AT PREDICTED TCA'}</strong></span>
      <span><small>Predicted miss distance</small><strong>{missDistance.toFixed(0)} m</strong></span>
      <span><small>Relative speed</small><strong>{(relativeSpeed / 1_000).toFixed(3)} km/s</strong></span>
      <span><small>ML risk score</small><strong>{modelScore.toFixed(3)}</strong></span>
      <button onClick={begin}><RotateCcw size={14} /> Replay TCA</button>
    </div>
    <div className="ml-replay-progress"><i style={{ width: `${progress * 100}%` }} /></div>
  </div>;
}
