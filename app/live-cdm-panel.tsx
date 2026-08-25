'use client';

import { CheckCircle2, Database, LockKeyhole, Play, Radio, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import streamFixture from './data/live-cdm-stream.json';
import type { LiveCdmMessage, LiveModelResponse } from './lib/live-model';
import { formatIst } from './lib/time';

const stream = streamFixture as {
  eventId: number;
  source: string;
  reservedFromTraining: boolean;
  cutoffDays: number;
  messageIntervalMs: number;
  messages: LiveCdmMessage[];
  recordedOutcome: LiveCdmMessage;
};

function modelProbability(logRisk: number | null) {
  return logRisk === null ? 'Unavailable' : (10 ** logRisk).toExponential(3);
}

export default function LiveCdmPanel({ compact = false }: { compact?: boolean }) {
  const [running, setRunning] = useState(false);
  const [nextTestIndex, setNextTestIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<LiveModelResponse | null>(null);
  const received = result?.feed?.messagesReceived ?? 0;
  const testFeed = result?.feed?.mode === 'held-out-test-feed';
  const externalFeed = result?.feed?.mode === 'external-operator';
  const completeScored = testFeed && received === stream.messages.length && !running;
  const inference = result?.inference ?? null;

  useEffect(() => {
    if (running) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/model/live', { cache: 'no-store' });
        if (response.ok && active) setResult(await response.json() as LiveModelResponse);
      } catch {
        // Preserve the last live state during a temporary connector failure.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_500);
    return () => { active = false; window.clearInterval(interval); };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    if (nextTestIndex >= stream.messages.length) {
      const completeTimer = window.setTimeout(() => setRunning(false), 0);
      return () => window.clearTimeout(completeTimer);
    }
    const timer = window.setTimeout(() => {
      const ingest = async () => {
        const response = await fetch('/api/model/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: stream.eventId,
            source: stream.source,
            mode: 'held-out-test-feed',
            message: stream.messages[nextTestIndex],
            reset: nextTestIndex === 0,
          }),
        });
        if (!response.ok) {
          setRunning(false);
          return;
        }
        setResult(await response.json() as LiveModelResponse);
        setNextTestIndex((value) => value + 1);
      };
      void ingest();
    }, nextTestIndex === 0 ? 80 : stream.messageIntervalMs);
    return () => window.clearTimeout(timer);
  }, [nextTestIndex, running]);

  function start() {
    setRevealed(false);
    setNextTestIndex(0);
    setRunning(true);
  }

  const title = externalFeed
    ? `Operator event ${result.feed?.eventId}`
    : testFeed
      ? `ESA test event ${result.feed?.eventId}`
      : 'Connector waiting for a CDM';
  const badge = running ? 'TEST STREAM' : externalFeed ? 'OPERATOR FEED' : testFeed ? (completeScored ? 'TEST COMPLETE' : 'TEST FEED') : 'LISTENING';

  return <section className={`ops-live-model ${compact ? 'compact' : ''} ${running ? 'running' : completeScored || externalFeed ? 'complete' : 'idle'}`}>
    <div className="ops-live-model-head">
      <span><Radio size={12} /> ML RISK PREDICTOR</span>
      <b>{badge}</b>
    </div>
    <div className="ops-live-model-title">
      <div><strong>{title}</strong><small>{result?.feed?.source ?? 'POST one compatible message to /api/model/live'}</small></div>
      <ShieldCheck size={18} />
    </div>
    <p className="ops-cdm-definition"><b>CDM</b> means Conjunction Data Message. It is a standard update for one predicted close approach containing TCA, miss distance, relative motion and the uncertainty of both orbits.</p>
    {result?.feed && <p className="ops-cdm-tca"><b>TCA:</b> {result.feed.tca
      ? formatIst(result.feed.tca, { seconds: true, year: true })
      : testFeed
        ? 'Relative T− timeline only. The ESA archive anonymizes the absolute event time.'
        : 'Awaiting an absolute TCA from the connected CDM provider.'}</p>}

    {inference ? <>
      {testFeed && <div className="ops-live-model-progress"><i style={{ width: `${received / stream.messages.length * 100}%` }} /></div>}
      <div className="ops-live-model-metrics">
        <span><small>CDMs received</small><strong>{testFeed ? `${received}/${stream.messages.length}` : received}</strong></span>
        <span><small>Latest update</small><strong>T−{inference.latestTimeToTca.toFixed(2)}d</strong></span>
        <span><small>ML risk score</small><strong>{inference.score.toFixed(3)}</strong></span>
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
    </> : <p className="ops-live-model-intro">The live endpoint is listening now. A connected operator service can send one CDM at a time; each arrival rebuilds 76 T−2 features and immediately reruns the trained model.</p>}

    <div className="ops-live-model-actions">
      <button onClick={start} disabled={running}>{completeScored ? <RotateCcw size={13} /> : <Play size={13} />}{completeScored ? 'Replay ESA test feed' : running ? 'Receiving test CDMs' : 'Run ESA test feed'}</button>
      {completeScored && <button className="secondary" onClick={() => setRevealed((value) => !value)}><LockKeyhole size={12} />{revealed ? 'Hide outcome' : 'Reveal outcome'}</button>}
    </div>
    {completeScored && revealed && <div className="ops-live-model-outcome"><span>Recorded final message</span><strong>Pc {modelProbability(stream.recordedOutcome.risk)}</strong><small>The final event remained above the 10⁻⁶ review threshold.</small></div>}
    <p className="ops-live-model-foot">Each CDM reruns {result?.model.treeCount ?? 67} boosted trees · the ML score drives analyst alerts and is not collision probability</p>
  </section>;
}
