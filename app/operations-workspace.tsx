'use client';

import dynamic from 'next/dynamic';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronDown, CircleDot, Clock3,
  Crosshair, Database, Eye, LocateFixed, Pause, Play, Radar, RefreshCw,
  RotateCcw, Satellite, ShieldCheck, Sparkles, TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import replayFixture from './data/esa-validation-replay.json';
import benchmarkFixture from './data/model-benchmark.json';
import {
  animateTcaReplay, isSatelliteObjectType, objectMarkerColor,
  TCA_REPLAY_DURATION_MS, tcaReplayStart, type TcaReplayPhase,
} from './lib/collision-visualization';
import { explainConjunction } from './lib/explanations';
import { INDIA_EO_FLEET } from './lib/fleet';
import { eventForSatellite, monitoredState, priorityReason } from './lib/monitoring';
import { comparePriority, formatProbability } from './lib/screening';
import type { OrbitCameraMode } from './orbit-globe';
import type {
  CatalogResponse, ConjunctionRecord, ConjunctionResponse, DataStatus, OmmRecord,
  ModelBenchmark, ScreeningPriority, T2ModelReplay, ThreatObject, ThreatResponse,
} from './lib/types';

const OrbitGlobe = dynamic(() => import('./orbit-globe'), {
  ssr: false,
  loading: () => <div className="globe-loading static">Starting orbital monitor…</div>,
});

const modelReplay = replayFixture as T2ModelReplay;
const modelBenchmark = benchmarkFixture as ModelBenchmark;
const benchmarkChampion = modelBenchmark.models.find((model) => model.id === modelBenchmark.championModelId)!;
const fleetIds = INDIA_EO_FLEET.objects.map((item) => item.catalogId);
const priorityLabels: Record<ScreeningPriority, string> = {
  review: 'Review', watch: 'Watch', low: 'Low', 'needs-data': 'Needs data',
};

function statusLabel(status?: DataStatus) {
  if (status === 'current') return 'Live';
  if (status === 'cached') return 'Cached';
  return 'Unavailable';
}

function statusTone(status?: DataStatus) {
  return status === 'current' ? 'current' : status === 'cached' ? 'cached' : 'unavailable';
}

function cleanName(value: string) {
  return value.replace(/\s*\[[+?−-]\]\s*$/, '').trim();
}

function dateUtc(value: string | null | undefined, seconds = false) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    second: seconds ? '2-digit' : undefined, timeZone: 'UTC', hour12: false,
  })} UTC`;
}

function countdown(tca: string, now: number) {
  const remaining = new Date(tca).getTime() - now;
  const absolute = Math.abs(remaining);
  const days = Math.floor(absolute / 86_400_000);
  const hours = Math.floor((absolute % 86_400_000) / 3_600_000);
  const minutes = Math.floor((absolute % 3_600_000) / 60_000);
  const value = days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  return remaining >= 0 ? `T−${value}` : `TCA +${value}`;
}

function metric(value: number | null, unit: string, digits = 2) {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(digits)} ${unit}`;
}

function counterpartFor(event: ConjunctionRecord, protectedId: number) {
  return event.primaryCatalogId === protectedId
    ? { id: event.secondaryCatalogId, name: event.secondaryName }
    : { id: event.primaryCatalogId, name: event.primaryName };
}

function EncounterOverlay({ event, protectedId, threat }: {
  event: ConjunctionRecord;
  protectedId: number;
  threat?: ThreatObject;
}) {
  const counterpart = counterpartFor(event, protectedId);
  const type = threat?.objectType === 'R/B' ? 'ROCKET BODY' : isSatelliteObjectType(threat?.objectType) ? 'SATELLITE' : 'DEBRIS';
  return <div className="ops-encounter-overlay" role="img" aria-label="Magnified closest-approach view">
    <div className="ops-encounter-head"><span>MAGNIFIED ENCOUNTER</span><b>NOT TO EARTH SCALE</b></div>
    <div className="ops-encounter-geometry">
      <span className="ops-protected"><Satellite size={18} /><b>{cleanName(event.primaryCatalogId === protectedId ? event.primaryName : event.secondaryName)}</b></span>
      <i><strong>{metric(event.rangeKm, 'km', 3)}</strong><small>reported miss range</small></i>
      <span className="ops-counterpart"><em /><b>{type}</b><small>{cleanName(counterpart.name)}</small></span>
    </div>
  </div>;
}

export default function OperationsWorkspace() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [conjunctions, setConjunctions] = useState<ConjunctionResponse | null>(null);
  const [threats, setThreats] = useState<ThreatResponse | null>(null);
  const [extraRecords, setExtraRecords] = useState<OmmRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<number | null>(null);
  const [simulationTime, setSimulationTime] = useState(0);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState<OrbitCameraMode>('global');
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const [replayPhase, setReplayPhase] = useState<TcaReplayPhase | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(0);
  const [catalogueVisible, setCatalogueVisible] = useState(false);
  const simulationRef = useRef(0);
  const lastTick = useRef(0);
  const replayCancel = useRef<(() => void) | null>(null);
  const replayLastCommitRef = useRef(0);
  const replayPhaseRef = useRef<TcaReplayPhase | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setClock(now);
      setSimulationTime(now);
      simulationRef.current = now;
      lastTick.current = now;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshLive = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    try {
      const response = await fetch('/api/live').then((result) => result.json() as Promise<{
        conjunctions: ConjunctionResponse;
        threats: ThreatResponse;
        refreshedAt: string;
      }>);
      setConjunctions(response.conjunctions);
      setThreats(response.threats);
      setLastRefresh(new Date(response.refreshedAt).getTime());
    } catch {
      // Keep the last current or cached monitoring snapshot available.
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/catalog?group=active')
      .then((response) => response.json() as Promise<CatalogResponse>)
      .then((result) => { if (active) setCatalog(result); })
      .catch(() => { if (active) setCatalog({ status: 'unavailable', source: 'Catalogue unavailable', sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), count: 0, objects: [] }); });
    fetch('/api/bootstrap')
      .then((response) => response.json() as Promise<{ conjunctions: ConjunctionResponse; threats: ThreatResponse; refreshedAt: string }>)
      .then((result) => {
        if (!active) return;
        setConjunctions(result.conjunctions);
        setThreats(result.threats);
        setLastRefresh(new Date(result.refreshedAt).getTime());
      })
      .finally(() => { if (active) void refreshLive(false); });
    const interval = window.setInterval(() => void refreshLive(false), 5 * 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [refreshLive]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (playing) {
        setSimulationTime((current) => {
          const next = current + (now - lastTick.current) * speed;
          simulationRef.current = next;
          return next;
        });
      }
      lastTick.current = now;
    }, 500);
    return () => window.clearInterval(interval);
  }, [playing, speed]);

  const recordMap = useMemo(() => {
    const map = new Map<number, OmmRecord>();
    catalog?.objects.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    threats?.objects.forEach((threat) => { if (threat.record) map.set(threat.catalogId, threat.record); });
    extraRecords.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    return map;
  }, [catalog, extraRecords, threats]);

  const threatsById = useMemo(() => new Map((threats?.objects ?? []).map((threat) => [threat.catalogId, threat])), [threats]);
  const rankedEvents = useMemo(() => [...(conjunctions?.events ?? [])].sort(comparePriority), [conjunctions]);

  const chooseProtectedId = useCallback((event: ConjunctionRecord) => {
    if (fleetIds.includes(event.primaryCatalogId)) return event.primaryCatalogId;
    if (fleetIds.includes(event.secondaryCatalogId)) return event.secondaryCatalogId;
    return event.primaryCatalogId;
  }, []);

  const selectEvent = useCallback(async (event: ConjunctionRecord) => {
    replayCancel.current?.();
    replayCancel.current = null;
    setReplayActive(false);
    setReplayPhase(null);
    const protectedId = chooseProtectedId(event);
    setSelectedEventId(event.id);
    setSelectedSatelliteId(protectedId);
    setCameraMode('pair-follow');
    setCameraResetKey((value) => value + 1);
    const ids = [event.primaryCatalogId, event.secondaryCatalogId];
    if (ids.every((id) => recordMap.has(id))) return;
    try {
      const response = await fetch(`/api/catalog?catnr=${ids.join(',')}`).then((result) => result.json() as Promise<CatalogResponse>);
      setExtraRecords((current) => {
        const merged = new Map(current.map((record) => [Number(record.NORAD_CAT_ID), record]));
        response.objects.forEach((record) => merged.set(Number(record.NORAD_CAT_ID), record));
        return [...merged.values()];
      });
    } catch {
      // Event metrics remain useful when current public geometry is unavailable.
    }
  }, [chooseProtectedId, recordMap]);

  const selectedEvent = useMemo(
    () => rankedEvents.find((event) => event.id === selectedEventId) ?? null,
    [rankedEvents, selectedEventId],
  );

  const selectedProtectedId = selectedEvent ? selectedSatelliteId ?? chooseProtectedId(selectedEvent) : selectedSatelliteId;
  const selectedCounterpart = selectedEvent && selectedProtectedId ? counterpartFor(selectedEvent, selectedProtectedId) : null;
  const selectedThreat = selectedCounterpart ? threatsById.get(selectedCounterpart.id) : undefined;
  const selectedSatellite = selectedSatelliteId ? INDIA_EO_FLEET.objects.find((item) => item.catalogId === selectedSatelliteId) : undefined;
  const explanation = selectedEvent ? explainConjunction(selectedEvent) : null;
  const focusRecords = useMemo(() => {
    const ids = new Set([
      ...fleetIds,
      ...(selectedEvent ? [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId] : []),
    ]);
    return [...ids].flatMap((id) => recordMap.get(id) ?? []);
  }, [recordMap, selectedEvent]);

  const cancelReplay = useCallback(() => {
    replayCancel.current?.();
    replayCancel.current = null;
    setReplayActive(false);
    setReplayPhase(null);
    setReplaySpeed(0);
    replayPhaseRef.current = null;
    replayLastCommitRef.current = 0;
  }, []);

  const runTcaReplay = useCallback(() => {
    if (!selectedEvent) return;
    cancelReplay();
    const target = new Date(selectedEvent.tca).getTime();
    if (!Number.isFinite(target)) return;
    const from = tcaReplayStart(simulationRef.current, target);
    simulationRef.current = from;
    setSimulationTime(from);
    setPlaying(false);
    setCameraMode('follow');
    setReplayPhase('follow');
    replayPhaseRef.current = 'follow';
    setReplaySpeed((target - from) / TCA_REPLAY_DURATION_MS);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      simulationRef.current = target;
      setSimulationTime(target);
      setCameraMode('encounter');
      setReplayPhase('encounter');
      return;
    }
    setReplayActive(true);
    replayCancel.current = animateTcaReplay({
      from,
      tca: target,
      duration: TCA_REPLAY_DURATION_MS,
      scheduler: {
        now: () => performance.now(),
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (id) => window.cancelAnimationFrame(id),
      },
      onUpdate: (frame) => {
        simulationRef.current = frame.simulationTime;
        const frameNow = performance.now();
        const phaseChanged = replayPhaseRef.current !== frame.phase;
        if (phaseChanged) {
          replayPhaseRef.current = frame.phase;
          setReplayPhase(frame.phase);
          if (frame.phase === 'acquire') setCameraMode('pair-follow');
          if (frame.phase === 'encounter') setCameraMode('encounter');
        }
        if (!frame.done && !phaseChanged && frameNow - replayLastCommitRef.current < 128) return;
        replayLastCommitRef.current = frameNow;
        setSimulationTime(frame.simulationTime);
      },
      onComplete: () => {
        replayCancel.current = null;
        simulationRef.current = target;
        setSimulationTime(target);
        setReplayActive(false);
        setReplaySpeed(0);
        setReplayPhase('encounter');
        replayPhaseRef.current = 'encounter';
        setCameraMode('encounter');
      },
    });
  }, [cancelReplay, selectedEvent]);

  useEffect(() => () => replayCancel.current?.(), []);

  function selectFleetSatellite(catalogId: number) {
    cancelReplay();
    setSelectedEventId(null);
    setSelectedSatelliteId(catalogId);
    setCameraMode('follow');
    setCameraResetKey((value) => value + 1);
  }

  function returnLive() {
    cancelReplay();
    const now = Date.now();
    simulationRef.current = now;
    setSimulationTime(now);
    setPlaying(true);
    setSpeed(1);
  }

  const alertCount = rankedEvents.filter((event) => event.priority === 'review' || event.priority === 'watch').length;
  const dataStatus = conjunctions?.status ?? catalog?.status;
  const namedEvents = rankedEvents.filter((event) => {
    const protectedId = chooseProtectedId(event);
    const counterpart = counterpartFor(event, protectedId);
    const threat = threatsById.get(counterpart.id);
    return threat && !/^UNKNOWN\b/i.test(threat.name);
  });
  const monitoredEvents = (namedEvents.length >= 6 ? namedEvents : rankedEvents).slice(0, 6);
  const modelReady = false;

  return <main className="ops-shell">
    <header className="ops-header">
      <div className="ops-brand"><span className="brand-glyph"><i /></span><div><strong>ORBITSHIELD</strong><small>Automated conjunction monitoring</small></div></div>
      <div className="ops-automation"><Radar size={15} /><span><strong>MONITORING ACTIVE</strong><small>6 satellites · 5-minute refresh</small></span></div>
      <div className="ops-header-summary"><span><b>{catalog?.count.toLocaleString() ?? 'N/A'}</b> active objects</span><i /><span><b>{threats?.positionedCount ?? 'N/A'}</b> risk objects mapped</span><i /><span><b>{alertCount}</b> alerts</span><i /><span><b>{modelBenchmark.models.length}</b> models tested</span></div>
      <button className="ops-refresh" onClick={() => void refreshLive(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Refreshing' : 'Refresh'}</button>
      <div className={`ops-feed-state ${statusTone(dataStatus)}`}><i /><span><b>{statusLabel(dataStatus)}</b><small>{lastRefresh ? dateUtc(new Date(lastRefresh).toISOString(), true) : 'Connecting'}</small></span></div>
    </header>

    <section className="ops-workspace">
      <aside className="ops-monitor-rail">
        <div className="ops-panel-heading"><div><span>MONITORED FLEET</span><strong>India Earth Observation</strong></div><b><Activity size={12} /> 6 ACTIVE</b></div>
        <div className="ops-fleet-list">
          {INDIA_EO_FLEET.objects.map((satellite) => {
            const event = eventForSatellite(rankedEvents, satellite.catalogId);
            const state = monitoredState(event);
            return <button key={satellite.catalogId} className={selectedSatelliteId === satellite.catalogId ? 'selected' : ''} onClick={() => selectFleetSatellite(satellite.catalogId)}>
              <span className="ops-sat-icon"><Satellite size={15} /></span>
              <span className="ops-sat-copy"><strong>{satellite.shortName}</strong><small>NORAD {satellite.catalogId} · {satellite.mission}</small></span>
              <span className={`ops-sat-state ${state.tone}`}><i />{state.label}</span>
            </button>;
          })}
        </div>

        <div className="ops-alert-heading"><span><AlertTriangle size={13} /> ACTIVE RISK ALERTS</span><b>{alertCount} REQUIRE ATTENTION</b></div>
        <div className="ops-alert-list">
          {monitoredEvents.map((event) => {
            const protectedId = chooseProtectedId(event);
            const counterpart = counterpartFor(event, protectedId);
            const protectedName = cleanName(event.primaryCatalogId === protectedId ? event.primaryName : event.secondaryName);
            return <button key={event.id} className={`${selectedEventId === event.id ? 'selected' : ''} ${event.priority}`} onClick={() => void selectEvent(event)}>
              <span className={`ops-alert-severity ${event.priority}`}><TriangleAlert size={14} /></span>
              <span className="ops-alert-copy"><strong>{protectedName}</strong><small>↳ {cleanName(counterpart.name)}</small><em>{priorityReason(event)}</em></span>
              <span className="ops-alert-metric"><b>{countdown(event.tca, clock)}</b><small>{event.rangeKm?.toFixed(2) ?? 'N/A'} km</small></span>
            </button>;
          })}
        </div>
        <div className="ops-rail-footer"><CircleDot size={12} /><span><strong>Automatic screening is running</strong><small>New source runs are ranked against the monitored fleet. Missing fields never receive an invented score.</small></span></div>
      </aside>

      <section className="ops-globe-stage">
        <OrbitGlobe
          catalogue={catalog?.objects ?? []}
          focusRecords={focusRecords}
          threats={threats?.objects ?? []}
          fleetIds={fleetIds}
          selectedEvent={selectedEvent}
          selectedSatelliteId={selectedSatelliteId}
          cameraMode={cameraMode}
          cameraResetKey={cameraResetKey}
          previewId={null}
          focusCatalogId={selectedSatelliteId}
          simulationTime={simulationTime}
          showCatalogue={catalogueVisible}
          focusSelectedOnly={false}
          showFleetLabels={!replayActive}
          replayPhase={replayPhase}
          replayActive={replayActive}
          onObjectSelect={selectFleetSatellite}
        />
        <div className="ops-globe-status">
          <span><i /> LIVE ORBITAL PICTURE</span>
          <strong>{selectedEvent ? `${cleanName(selectedEvent.primaryName)} ↔ ${cleanName(selectedEvent.secondaryName)}` : selectedSatellite?.name ?? 'Fleet overview'}</strong>
          <small>{selectedEvent ? `${priorityLabels[selectedEvent.priority]} alert · ${countdown(selectedEvent.tca, simulationTime)}` : 'Select a monitored satellite or alert'}</small>
        </div>
        <div className="ops-layer-legend"><span><i className="sat" /> Monitored satellites</span><span><i className="debris" /> Screened debris</span><span><i className="orbit" /> Propagated orbit</span></div>
        {selectedEvent && <div className="ops-event-orbit-legend"><span><i className="protected" /> Protected satellite orbit</span><span><i className="counterpart" style={{ borderColor: objectMarkerColor(selectedThreat?.objectType, selectedThreat?.size) }} /> Counterpart orbit</span></div>}
        {selectedEvent && selectedProtectedId && replayPhase === 'encounter' && <EncounterOverlay event={selectedEvent} protectedId={selectedProtectedId} threat={selectedThreat} />}
        <div className="ops-globe-controls">
          <div className="ops-time-control"><button onClick={() => { cancelReplay(); setPlaying((value) => !value); }} aria-label={playing ? 'Pause orbital animation' : 'Play orbital animation'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Orbital animation speed"><option value={1}>1×</option><option value={10}>10×</option><option value={60}>60×</option></select><span>{dateUtc(new Date(simulationTime).toISOString(), true)}</span></div>
          <div className="ops-camera-control"><button className={cameraMode === 'global' ? 'active' : ''} onClick={() => { setCameraMode('global'); setCameraResetKey((value) => value + 1); }}><RotateCcw size={13} /> Globe</button><button className={cameraMode === 'follow' || cameraMode === 'pair-follow' ? 'active' : ''} onClick={() => { setCameraMode(selectedEvent ? 'pair-follow' : 'follow'); setCameraResetKey((value) => value + 1); }} disabled={!selectedSatelliteId}><LocateFixed size={13} /> Track</button><button className={cameraMode === 'free' ? 'active' : ''} onClick={() => { setCameraMode('free'); setCameraResetKey((value) => value + 1); }}><Eye size={13} /> Free 3D</button><button className={catalogueVisible ? 'active' : ''} onClick={() => setCatalogueVisible((value) => !value)}><CircleDot size={13} /> Context</button></div>
          <button className="ops-tca-button" onClick={runTcaReplay} disabled={!selectedEvent || replayActive}><Crosshair size={15} /><span><strong>{replayActive ? `${replayPhase === 'follow' ? 'Following satellite' : replayPhase === 'acquire' ? 'Acquiring debris' : 'At closest approach'}` : 'Follow alert to TCA'}</strong><small>{replayActive ? `≈ ${Math.round(replaySpeed)}× accelerated` : '20 minutes in 6.5 seconds'}</small></span></button>
          <button className="ops-live-button" onClick={returnLive}><Clock3 size={13} /> Now</button>
        </div>
      </section>

      <aside className="ops-analysis-rail">
        <div className="ops-analysis-heading"><div><span><Sparkles size={13} /> ORBITSHIELD ANALYST</span><strong>Risk analysis</strong></div><b><Bot size={14} /> AUTOMATED</b></div>
        {selectedEvent && explanation && selectedCounterpart ? <>
          <section className={`ops-current-alert ${selectedEvent.priority}`}>
            <div><span><TriangleAlert size={13} /> AI-ASSISTED ALERT</span><b className={selectedEvent.priority}>{priorityLabels[selectedEvent.priority]}</b></div>
            <strong>{cleanName(selectedEvent.primaryCatalogId === selectedProtectedId ? selectedEvent.primaryName : selectedEvent.secondaryName)}</strong>
            <small>Possible conjunction with {cleanName(selectedCounterpart.name)} · NORAD {selectedCounterpart.id}</small>
          </section>

          <section className="ops-natural-language">
            <div className="ops-section-label"><span>NATURAL-LANGUAGE BRIEF</span><b><ShieldCheck size={11} /> VERIFIED FIELDS ONLY</b></div>
            <p>{explanation.whatIsHappening}</p>
            <strong>{explanation.whyPrioritized}</strong>
          </section>

          <section className="ops-risk-metrics">
            <div><span>Closest approach</span><strong>{countdown(selectedEvent.tca, simulationTime)}</strong><small>{dateUtc(selectedEvent.tca)}</small></div>
            <div><span>Miss range</span><strong>{metric(selectedEvent.rangeKm, 'km', 3)}</strong><small>SOCRATES reported</small></div>
            <div><span>Relative speed</span><strong>{metric(selectedEvent.relativeSpeedKmS, 'km/s', 3)}</strong><small>At TCA</small></div>
            <div><span>Maximum Pc</span><strong>{formatProbability(selectedEvent.maximumProbability)}</strong><small>Screening estimate</small></div>
          </section>

          <section className="ops-model-state">
            <div className="ops-section-label"><span>MODEL COVERAGE</span><b className={modelReady ? 'ready' : 'waiting'}>{modelReady ? 'SCORING' : 'AWAITING CDM'}</b></div>
            <div className="ops-model-flow"><span className="done"><CheckCircle2 size={13} /> Live screening</span><i /><span className="done"><CheckCircle2 size={13} /> Alert explanation</span><i /><span><Database size={13} /> CDM triage</span></div>
            <p>The close-approach alert is automatic. Five trained T−2 models activate when an operator CDM history supplies covariance and uncertainty fields.</p>
            <details><summary>View five-model benchmark <ChevronDown size={13} /></summary><div className="ops-benchmark-list">{modelBenchmark.models.map((model) => <div key={model.id} className={model.id === modelBenchmark.championModelId ? 'champion' : ''}><span><strong>{model.name}</strong><small>{model.family}</small></span><b>{model.validation.f2.toFixed(3)}<small>VAL F2</small></b><b>{model.test.pr_auc.toFixed(3)}<small>TEST PR-AUC</small></b></div>)}</div><div className="ops-model-proof"><span><b>{modelBenchmark.persistenceBaseline.f2.toFixed(3)}</b> persistence F2</span><span><b>{modelReplay.inference.rawScore.toFixed(3)}</b> held-out replay score</span><span><b>{modelBenchmark.dataset.eventsTest.toLocaleString()}</b> test events</span></div><p>{modelBenchmark.championModelName} leads validation F2. These results validate the CDM triage pipeline and are not a score for this public SOCRATES event.</p></details>
          </section>

          <section className="ops-action-plan">
            <div className="ops-section-label"><span>RECOMMENDED WORKFLOW</span><b>HUMAN DECISION</b></div>
            <ol>{explanation.recommendedSteps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}</ol>
          </section>

          <button className="ops-primary-action" onClick={runTcaReplay} disabled={replayActive}><Crosshair size={16} /><span><strong>{replayActive ? 'Following the encounter' : 'Visualize this alert'}</strong><small>{replayActive ? `Replay running at about ${Math.round(replaySpeed)}×` : 'Track the satellite and debris to TCA'}</small></span></button>
          <p className="ops-safety-note"><ShieldCheck size={13} /> OrbitShield recommends review steps, never manoeuvres. Qualified mission personnel retain every operational decision.</p>
        </> : <div className="ops-no-alert ops-monitoring-overview"><Radar size={25} /><strong>Fleet monitoring is active</strong><p>Six India Earth Observation satellites are propagating on the globe. Select a satellite to follow its orbit or choose an alert to open the risk analysis.</p><div><span><b>{fleetIds.length}</b> monitored satellites</span><span><b>{alertCount}</b> watch or review alerts</span><span><b>{threats?.positionedCount ?? 0}</b> risk objects mapped</span></div><section className="ops-benchmark-summary"><span>FIVE-MODEL T−2 LAB</span><strong>{modelBenchmark.championModelName}</strong><small>Champion selected on validation F2 · event {modelBenchmark.dataset.reservedEventId} excluded</small><div><b>{benchmarkChampion.validation.f2.toFixed(3)}<em>VAL F2</em></b><b>{benchmarkChampion.test.f2.toFixed(3)}<em>TEST F2</em></b><b>{(benchmarkChampion.test.recall * 100).toFixed(1)}%<em>RECALL</em></b></div></section></div>}
      </aside>
    </section>
  </main>;
}
