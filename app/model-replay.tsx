'use client';

import { ArrowLeft, BarChart3, CheckCircle2, ChevronDown, Database, Eye, EyeOff, LockKeyhole, Play, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { CdmSequence, T2ModelReplay } from './lib/types';

function probability(value: number) {
  return value < 0.001 ? value.toExponential(3) : value.toFixed(4);
}

function evidenceValue(value: number, unit?: string) {
  const formatted = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(3);
  return `${formatted}${unit ? ` ${unit}` : ''}`;
}

export function RiskHistoryCard({ sequence, replay }: { sequence: CdmSequence; replay: T2ModelReplay }) {
  const points = sequence.visibleCdms;
  const values = points.map((point) => point.risk ?? -8);
  const min = Math.min(...values) - 0.2;
  const max = Math.max(...values) + 0.2;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 50 : 8 + index / (points.length - 1) * 84;
    const y = 88 - ((point.risk ?? min) - min) / Math.max(0.001, max - min) * 68;
    return { x, y, point };
  });
  const path = coords.map((point) => `${point.x},${point.y}`).join(' ');
  return <div className="risk-history-card">
    <div className="risk-history-head"><span><LockKeyhole size={14} /> Evidence locked at T−2</span><b>{points.length} visible CDMs</b></div>
    <svg viewBox="0 0 100 100" role="img" aria-label="Visible collision-risk history through the two-day cutoff">
      <defs><linearGradient id="riskLine" x1="0" x2="1"><stop stopColor="#4d6570" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
      {[24, 46, 68, 90].map((y) => <line key={y} x1="7" y1={y} x2="93" y2={y} className="risk-grid" />)}
      <polyline points={path} fill="none" stroke="url(#riskLine)" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
      {coords.map(({ x, y, point }) => <circle key={point.time_to_tca} cx={x} cy={y} r="1.8" className="risk-dot"><title>{`T-${point.time_to_tca.toFixed(2)}d, log10 risk ${(point.risk ?? 0).toFixed(4)}`}</title></circle>)}
      <line x1="94" y1="12" x2="94" y2="92" className="cutoff-line" />
      <text x="92" y="9" textAnchor="end">T−2 cutoff</text>
    </svg>
    <div className="risk-history-footer"><span>First visible · T−{points[0].time_to_tca.toFixed(2)}d</span><strong>Latest risk {replay.baseline.latestVisibleRisk.toFixed(4)}</strong></div>
  </div>;
}

export default function ModelReplayPanel({
  sequence,
  replay,
  modelRun,
  revealed,
  onRun,
  onReveal,
  onBack,
}: {
  sequence: CdmSequence;
  replay: T2ModelReplay;
  modelRun: boolean;
  revealed: boolean;
  onRun: () => void;
  onReveal: () => void;
  onBack: () => void;
}) {
  return <div className="model-replay-panel">
    <button className="replay-back" onClick={onBack}><ArrowLeft size={14} /> Back to public event</button>
    <div className="model-replay-head"><div><span>HISTORICAL AI REPLAY · ESA CDMS</span><strong>Event {replay.eventId}</strong><small>{sequence.visibleCdms.length} messages visible through T−2 · {replay.selectionDisclosure}</small></div><b><ShieldCheck size={13} /> Held out</b></div>

    <section className="cutoff-summary"><LockKeyhole size={16} /><span><strong>Decision evidence stops at T−{replay.cutoffDays} days</strong><small>Later messages and the recorded outcome remain hidden from the model.</small></span></section>

    {!modelRun ? <section className="run-model-card">
      <Database size={22} />
      <span><strong>Run OrbitShield T−2 triage</strong><small>Compare the strong persistence baseline with an independent gradient-boosted priority signal.</small></span>
      <button onClick={onRun}><Play size={15} /> Run trained model</button>
    </section> : <>
      <div className="model-result-grid">
        <section><span>Safety baseline</span><strong>REVIEW</strong><b>log₁₀ risk {replay.baseline.predictedFinalRisk.toFixed(4)}</b><small>Latest-risk persistence</small></section>
        <section className="ai-result"><span>AI triage</span><strong>{replay.inference.triage.toUpperCase()}</strong><b>score {replay.inference.rawScore.toFixed(3)} · threshold {replay.model.scoreThreshold.toFixed(2)}</b><small>{replay.calibration.displayWarning}</small></section>
      </div>
      <section className="model-conclusion"><CheckCircle2 size={17} /><span><strong>Independent signal supports continued analyst review.</strong><small>The validated residual weight is zero, so the continuous forecast remains the persistence baseline.</small></span></section>
      <section className="driver-list"><div className="section-head"><span>What drove the model</span><b>Grouped evidence</b></div>{replay.drivers.slice(0, 3).map((driver) => <article key={driver.id}><div><span>{driver.label}</span><b className={driver.direction}>{driver.contributionLogOdds > 0 ? '+' : ''}{driver.contributionLogOdds.toFixed(2)}</b></div>{driver.evidence.slice(0, 2).map((item) => <p key={item.label}><span>{item.label}</span><strong>{evidenceValue(item.value, item.unit)}</strong></p>)}</article>)}</section>
    </>}

    <section className={`recorded-outcome ${revealed ? 'revealed' : ''}`}>
      <div className="section-head"><span>Recorded final outcome</span><b>{revealed ? 'Revealed after inference' : 'Hidden'}</b></div>
      {revealed ? <><strong>Final Pc {probability(replay.recordedOutcome.finalProbability)}</strong><p>Review priority was confirmed. The recorded probability was {replay.recordedOutcome.probabilityRatioToBaseline.toFixed(2)}× the T−2 persistence estimate.</p></> : <p>Reveal the recorded message only after inspecting the T−2 evidence and model result.</p>}
      <button onClick={onReveal} disabled={!modelRun}>{revealed ? <EyeOff size={14} /> : <Eye size={14} />}{revealed ? 'Hide outcome' : 'Reveal recorded outcome'}</button>
    </section>

    <details className="model-method"><summary>Validation and limitations <ChevronDown size={14} /></summary><div className="evaluation-strip"><span><b>{replay.evaluation.testEvents.toLocaleString()}</b> test events</span><span><b>{(replay.evaluation.baselineRecall * 100).toFixed(1)}%</b> baseline recall</span><span><b>{replay.evaluation.modelPrAuc.toFixed(3)}</b> model PR-AUC</span></div><ul>{replay.limitations.map((item) => <li key={item}><TriangleAlert size={12} />{item}</li>)}</ul><p><BarChart3 size={13} /> Drivers are grouped model contributions, not causal explanations. Source: official ESA Collision Avoidance Challenge archive.</p></details>
  </div>;
}
