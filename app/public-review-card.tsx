'use client';

import { ArrowRight, ChevronDown, Crosshair, Database, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatProbability } from './lib/screening';
import type { TcaReplayPhase } from './lib/collision-visualization';
import type { ConjunctionRecord } from './lib/types';

const labels = { review: 'Review', watch: 'Watch', low: 'Low', 'needs-data': 'Needs data' } as const;

function cleanName(value: string) {
  return value.replace(/\s*\[[+?−-]\]\s*$/, '').trim();
}

function metric(value: number | null, unit: string, digits = 3) {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(digits)} ${unit}`;
}

export default function PublicReviewCard({
  event,
  tcaLabel,
  tcaTime,
  counterpartKind,
  replayActive,
  replayPhase,
  replaySpeed,
  followAvailable,
  onFollow,
  onAiReplay,
  technicalEvidence,
}: {
  event: ConjunctionRecord;
  tcaLabel: string;
  tcaTime: string;
  counterpartKind: string;
  replayActive: boolean;
  replayPhase: TcaReplayPhase | null;
  replaySpeed: number;
  followAvailable: boolean;
  onFollow: () => void;
  onAiReplay: () => void;
  technicalEvidence: ReactNode;
}) {
  return <div className="public-review-card">
    <div className="review-card-head">
      <div><span>PUBLIC SCREENING · CELESTRAK</span><strong>{cleanName(event.primaryName)}</strong><small>with {cleanName(event.secondaryName)} · {counterpartKind}</small></div>
      <b className={`priority-pill ${event.priority}`}>{labels[event.priority]}</b>
    </div>

    <section className="review-decision">
      <span>Why it needs attention</span>
      <strong>{event.reasons[0] ?? 'The available fields require analyst review.'}</strong>
      <p>{event.reasons.slice(1, 3).join(' ')}</p>
    </section>

    <div className="review-metrics">
      <div><span>TCA</span><strong>{tcaLabel}</strong><small>{tcaTime}</small></div>
      <div><span>Reported range</span><strong>{metric(event.rangeKm, 'km')}</strong></div>
      <div><span>Relative speed</span><strong>{metric(event.relativeSpeedKmS, 'km/s')}</strong></div>
      <div><span>Maximum probability</span><strong>{formatProbability(event.maximumProbability)}</strong></div>
    </div>

    {replayActive ? <div className="tca-replay-status" aria-live="polite">
      <Crosshair size={16} />
      <span><strong>{replayPhase === 'follow' ? 'Following protected satellite' : replayPhase === 'acquire' ? 'Acquiring counterpart' : 'Framing closest approach'}</strong><small>Public-element replay · approximately {Math.round(replaySpeed)}×</small></span>
    </div> : <div className="review-actions">
      <button className="primary" onClick={onFollow} disabled={!followAvailable}><Crosshair size={16} /><span><strong>{followAvailable ? 'Follow to TCA' : 'Preparing orbit geometry'}</strong><small>{followAvailable ? '20-minute path compressed to 6.5 seconds' : 'Event metrics remain available while positions load'}</small></span></button>
      <button onClick={onAiReplay}><Database size={16} /><span><strong>Run AI replay</strong><small>Held-out ESA event at T−2</small></span><ArrowRight size={15} /></button>
    </div>}

    <div className="analyst-boundary"><ShieldCheck size={15} /><span><strong>Human decision boundary</strong><small>OrbitShield prioritizes evidence. A qualified analyst owns escalation and every operational decision.</small></span></div>

    <details className="technical-evidence"><summary>Technical evidence <ChevronDown size={14} /></summary>{technicalEvidence}</details>
  </div>;
}
