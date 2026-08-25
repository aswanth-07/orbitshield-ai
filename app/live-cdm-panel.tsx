'use client';

import { CheckCircle2, Database, LockKeyhole, Play, Radio, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import streamFixture from './data/live-cdm-stream.json';
import type { LiveCdmInference, LiveCdmMessage } from './lib/live-model';

const stream = streamFixture as {
  eventId: number;
  source: string;
  reservedFromTraining: boolean;
  cutoffDays: number;
  messageIntervalMs: number;
  messages: LiveCdmMessage[];
  recordedOutcome: LiveCdmMessage;
};

type ScoreResponse = {
  status: 'scored' | 'provisional';
  computedAt: string;
  model: { id: string; name: string; treeCount: number; scoreThreshold: number; cutoffDays: number };
  inference: LiveCdmInference;
};

function modelProbability(logRisk: number | null) {
  return logRisk === null ? 'Unavailable' : (10 ** logRisk).toExponential(3);
}

export default function LiveCdmPanel({ compact = false }: { compact?: boolean }) {
  const [received, setReceived] = useState(0);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [scoring, setScoring] = useState(false);
  const complete = received === stream.messages.length;
  const completeScored = complete && result?.inference.messagesSeen === stream.messages.length && !scoring;
  const messages = useMemo(() => stream.messages.slice(0, received), [received]);
  const inference = result?.inference ?? null;

  useEffect(() => {
    if (!messages.length) {
      const resetTimer = window.setTimeout(() => setResult(null), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const controller = new AbortController();
    const score = async () => {
      setScoring(true);
      try {
        const response = await fetch('/api/model/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: stream.eventId, source: stream.source, messages }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Model scoring failed');
        setResult(await response.json() as ScoreResponse);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResult(null);
      } finally {
        if (!controller.signal.aborted) setScoring(false);
      }
    };
    void score();
    return () => controller.abort();
  }, [messages]);

  useEffect(() => {
    if (!running) return;
    if (received >= stream.messages.length) {
      const completeTimer = window.setTimeout(() => setRunning(false), 0);
      return () => window.clearTimeout(completeTimer);
    }
    const timer = window.setTimeout(
      () => setReceived((value) => Math.min(stream.messages.length, value + 1)),
      stream.messageIntervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [received, running]);

  function start() {
    setRevealed(false);
    setReceived(1);
    setRunning(true);
  }

  return <section className={`ops-live-model ${compact ? 'compact' : ''} ${running || scoring ? 'running' : completeScored ? 'complete' : 'idle'}`}>
    <div className="ops-live-model-head">
      <span><Radio size={12} /> LIVE CDM INFERENCE</span>
      <b>{running ? 'STREAMING' : scoring ? 'SCORING' : completeScored ? 'MODEL COMPLETE' : 'READY'}</b>
    </div>
    <div className="ops-live-model-title">
      <div><strong>ESA event {stream.eventId}</strong><small>Held out from training · evidence locked at T−{stream.cutoffDays} days</small></div>
      <ShieldCheck size={18} />
    </div>

    {inference ? <>
      <div className="ops-live-model-progress"><i style={{ width: `${received / stream.messages.length * 100}%` }} /></div>
      <div className="ops-live-model-metrics">
        <span><small>CDMs received</small><strong>{received}/{stream.messages.length}</strong></span>
        <span><small>Latest update</small><strong>T−{inference.latestTimeToTca.toFixed(2)}d</strong></span>
        <span><small>Model score</small><strong>{inference.score.toFixed(3)}</strong></span>
        <span><small>Feature coverage</small><strong>{(inference.inputCoverage * 100).toFixed(1)}%</strong></span>
      </div>
      <div className={`ops-live-model-decision ${inference.triage}`}>
        {inference.triage === 'elevated' ? <CheckCircle2 size={17} /> : <Database size={17} />}
        <span><small>Histogram Gradient Boosting · threshold {inference.threshold.toFixed(2)}</small><strong>{inference.triage === 'elevated' ? 'ELEVATED · ANALYST REVIEW' : 'ROUTINE MONITORING'}</strong></span>
      </div>
      {!compact && <div className="ops-live-model-evidence">
        <span><small>Visible log₁₀ risk</small><b>{inference.latestRisk?.toFixed(4) ?? 'N/A'}</b></span>
        <span><small>Latest miss distance</small><b>{inference.latestMissDistance?.toFixed(0) ?? 'N/A'} m</b></span>
        <span><small>Minimum observed</small><b>{inference.minimumMissDistance?.toFixed(0) ?? 'N/A'} m</b></span>
      </div>}
    </> : <p className="ops-live-model-intro">Replay a real sequence of operator-style conjunction messages. Every arrival rebuilds 76 T−2 features and executes the trained champion model in this browser.</p>}

    <div className="ops-live-model-actions">
      <button onClick={start} disabled={running}>{complete ? <RotateCcw size={13} /> : <Play size={13} />}{complete ? 'Replay CDM stream' : running ? 'Receiving CDMs' : 'Start live model replay'}</button>
      {completeScored && <button className="secondary" onClick={() => setRevealed((value) => !value)}><LockKeyhole size={12} />{revealed ? 'Hide outcome' : 'Reveal outcome'}</button>}
    </div>
    {complete && revealed && <div className="ops-live-model-outcome"><span>Recorded final message</span><strong>Pc {modelProbability(stream.recordedOutcome.risk)}</strong><small>The final event remained above the 10⁻⁶ review threshold.</small></div>}
    <p className="ops-live-model-foot">Real trained artifact · {result?.model.treeCount ?? 67} boosted trees · scored through the live model API · not collision probability</p>
  </section>;
}
