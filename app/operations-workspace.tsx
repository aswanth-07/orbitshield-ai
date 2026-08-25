'use client';

import dynamic from 'next/dynamic';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronDown, CircleDot, Clock3,
  Crosshair, Database, Eye, LocateFixed, Maximize2, Minimize2, Pause, Play, Radar, RefreshCw,
  RotateCcw, Satellite, ShieldCheck, Sparkles, TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import fleetOrbitFixture from './data/fleet-orbits.snapshot.json';
import benchmarkFixture from './data/model-benchmark.json';
import {
  animateTcaReplay, isSatelliteObjectType,
  TCA_REPLAY_DURATION_MS, tcaReplayStart, type TcaReplayFrame, type TcaReplayPhase,
} from './lib/collision-visualization';
import { explainConjunction } from './lib/explanations';
import { INDIA_EO_FLEET } from './lib/fleet';
import { eventForSatellite, monitoredState, priorityReason } from './lib/monitoring';
import { PUBLIC_TRIAGE_MODEL, scorePublicConjunction } from './lib/public-triage';
import { comparePriority, formatProbability } from './lib/screening';
import { advanceSimulationTime, formatIst } from './lib/time';
import type { OrbitCameraMode } from './orbit-globe';
import type {
  CatalogResponse, ConjunctionRecord, ConjunctionResponse, DataStatus, OmmRecord,
  ModelBenchmark, ScreeningPriority, ThreatObject, ThreatResponse,
} from './lib/types';

const OrbitGlobe = dynamic(() => import('./orbit-globe'), {
  ssr: false,
  loading: () => <div className="globe-loading static">Starting orbital monitor…</div>,
});

const fleetOrbitSnapshot = fleetOrbitFixture as {
  source: string;
  elementSource: string;
  objects: Array<{ catalogId: number; epoch: string; tleLine1: string; tleLine2: string }>;
};
const modelBenchmark = benchmarkFixture as ModelBenchmark;
const benchmarkChampion = modelBenchmark.models.find((model) => model.id === modelBenchmark.championModelId)!;
const benchmarkMaxTestF2 = Math.max(...modelBenchmark.models.map((model) => model.test.f2));
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
    <div className="ops-encounter-head"><span><i /> TCA TARGET · CLOSEST APPROACH</span><b>MAGNIFIED, NOT TO EARTH SCALE</b></div>
    <div className="ops-encounter-geometry">
      <span className="ops-protected"><Satellite size={18} /><b>{cleanName(event.primaryCatalogId === protectedId ? event.primaryName : event.secondaryName)}</b></span>
      <i><strong>{metric(event.rangeKm, 'km', 3)}</strong><small>reported miss range</small></i>
      <span className="ops-counterpart"><em /><b>{type}</b><small>{cleanName(counterpart.name)}</small></span>
    </div>
  </div>;
}

function EsaModelEvidence({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <aside className={`ops-esa-model-evidence ${open ? 'open' : 'collapsed'}`} aria-label="ESA CDM model evidence">
    <button className="ops-esa-model-head" onClick={onToggle} aria-expanded={open}>
      <span><Bot size={13} /><i><strong>ESA CDM MODEL</strong><small>Professional intelligence tier</small></i></span>
      <b>{open ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</b>
    </button>
    {open && <>
      <div className="ops-esa-champion">
        <span><small>Selected champion</small><strong>{benchmarkChampion.name}</strong></span>
        <b>{benchmarkChampion.test.f2.toFixed(3)}<small>TEST F2</small></b>
      </div>
      <div className="ops-esa-proof-grid">
        <span><b>{modelBenchmark.dataset.featureCount}</b><small>CDM features</small></span>
        <span><b>{benchmarkChampion.test.recall.toFixed(3)}</b><small>Test recall</small></span>
        <span><b>{modelBenchmark.dataset.eventsTest.toLocaleString()}</b><small>Held-out events</small></span>
      </div>
      <div className="ops-esa-model-flow"><span>CDM sequence</span><i>→</i><span>76 features</span><i>→</i><span>HGB triage</span></div>
      <div className="ops-esa-model-bars">
        {modelBenchmark.models.map((model) => <div key={model.id} className={model.id === modelBenchmark.championModelId ? 'champion' : ''}>
          <span>{model.name}</span><i><b style={{ width: `${(model.test.f2 / benchmarkMaxTestF2) * 100}%` }} /></i><em>{model.test.f2.toFixed(3)}</em>
        </div>)}
      </div>
      <p>Trained on ESA conjunction messages with covariance and uncertainty fields. It becomes the deeper inference tier when an operator connects compatible CDMs.</p>
    </>}
  </aside>;
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
  const [cameraMode, setCameraMode] = useState<OrbitCameraMode>('global');
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const [replayPhase, setReplayPhase] = useState<TcaReplayPhase | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(0);
  const [catalogueVisible, setCatalogueVisible] = useState(true);
  const [trajectoryStartTime, setTrajectoryStartTime] = useState<number | null>(null);
  const [selectedMlAlertId, setSelectedMlAlertId] = useState<string | null>(null);
  const [esaEvidenceOpen, setEsaEvidenceOpen] = useState(true);
  const [pendingGlobeReplayId, setPendingGlobeReplayId] = useState<string | null>(null);
  const simulationRef = useRef(0);
  const lastTick = useRef(0);
  const replayCancel = useRef<(() => void) | null>(null);
  const replayFrameRef = useRef<TcaReplayFrame | null>(null);
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
    lastTick.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (playing) {
        setSimulationTime((current) => {
          const next = advanceSimulationTime(current, now - lastTick.current, 1);
          simulationRef.current = next;
          return next;
        });
      }
      lastTick.current = now;
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing]);

  const recordMap = useMemo(() => {
    const map = new Map<number, OmmRecord>();
    catalog?.objects.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    threats?.objects.forEach((threat) => { if (threat.record) map.set(threat.catalogId, threat.record); });
    fleetOrbitSnapshot.objects.forEach((orbit) => {
      const record = map.get(orbit.catalogId);
      if (!record) return;
      map.set(orbit.catalogId, {
        ...record,
        EPOCH: orbit.epoch,
        TLE_LINE1: orbit.tleLine1,
        TLE_LINE2: orbit.tleLine2,
        ORBIT_SOURCE: `${fleetOrbitSnapshot.source} · ${fleetOrbitSnapshot.elementSource}`,
      });
    });
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

  const selectEvent = useCallback(async (event: ConjunctionRecord, startReplay = false, modelAlert = false) => {
    replayCancel.current?.();
    replayCancel.current = null;
    setReplayActive(false);
    setReplayPhase(null);
    setSelectedMlAlertId(modelAlert ? event.id : null);
    const protectedId = chooseProtectedId(event);
    const tcaTime = new Date(event.tca).getTime();
    const currentTime = simulationRef.current || Date.now();
    const approachStart = Number.isFinite(tcaTime) ? tcaReplayStart(currentTime, tcaTime) : currentTime;
    setTrajectoryStartTime(Number.isFinite(tcaTime) ? approachStart : null);
    simulationRef.current = approachStart;
    setSimulationTime(approachStart);
    setPlaying(false);
    setSelectedEventId(event.id);
    setSelectedSatelliteId(protectedId);
    setPendingGlobeReplayId(startReplay ? event.id : null);
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
  const selectedFleetSatellite = selectedSatelliteId ? INDIA_EO_FLEET.objects.find((item) => item.catalogId === selectedSatelliteId) : undefined;
  const selectedRecord = selectedSatelliteId ? recordMap.get(selectedSatelliteId) : undefined;
  const selectedObjectThreat = selectedSatelliteId ? threatsById.get(selectedSatelliteId) : undefined;
  const selectedObjectName = selectedRecord?.OBJECT_NAME ?? selectedObjectThreat?.name ?? selectedFleetSatellite?.name;
  const selectedObjectEvents = useMemo(() => selectedSatelliteId
    ? rankedEvents.filter((event) => event.primaryCatalogId === selectedSatelliteId || event.secondaryCatalogId === selectedSatelliteId)
    : [], [rankedEvents, selectedSatelliteId]);
  const explanation = selectedEvent ? explainConjunction(selectedEvent) : null;
  const focusRecords = useMemo(() => {
    const ids = new Set([
      ...fleetIds,
      ...(selectedEvent ? [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId] : []),
      ...(selectedSatelliteId ? [selectedSatelliteId] : []),
    ]);
    return [...ids].flatMap((id) => recordMap.get(id) ?? []);
  }, [recordMap, selectedEvent, selectedSatelliteId]);

  const cancelReplay = useCallback(() => {
    replayCancel.current?.();
    replayCancel.current = null;
    setReplayActive(false);
    setReplayPhase(null);
    setReplaySpeed(0);
    replayFrameRef.current = null;
    replayPhaseRef.current = null;
  }, []);

  const runTcaReplay = useCallback(() => {
    if (!selectedEvent) return;
    cancelReplay();
    const target = new Date(selectedEvent.tca).getTime();
    if (!Number.isFinite(target)) return;
    const from = tcaReplayStart(simulationRef.current, target);
    setTrajectoryStartTime(from);
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
        replayFrameRef.current = frame;
        const phaseChanged = replayPhaseRef.current !== frame.phase;
        if (phaseChanged) {
          replayPhaseRef.current = frame.phase;
          setReplayPhase(frame.phase);
          if (frame.phase === 'acquire') setCameraMode('pair-follow');
          if (frame.phase === 'encounter') setCameraMode('encounter');
        }
      },
      onComplete: () => {
        replayCancel.current = null;
        replayFrameRef.current = null;
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

  useEffect(() => {
    if (!pendingGlobeReplayId || selectedEvent?.id !== pendingGlobeReplayId) return;
    const pairReady = [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId]
      .every((catalogId) => recordMap.has(catalogId));
    if (!pairReady) return;
    const frame = window.requestAnimationFrame(() => {
      setPendingGlobeReplayId(null);
      runTcaReplay();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingGlobeReplayId, recordMap, runTcaReplay, selectedEvent]);

  useEffect(() => () => replayCancel.current?.(), []);

  function selectFleetSatellite(catalogId: number) {
    cancelReplay();
    setPendingGlobeReplayId(null);
    setSelectedMlAlertId(null);
    setSelectedEventId(null);
    setTrajectoryStartTime(null);
    setSelectedSatelliteId(catalogId);
    setCameraMode('follow');
    setCameraResetKey((value) => value + 1);
  }

  function returnLive() {
    cancelReplay();
    setPendingGlobeReplayId(null);
    const now = Date.now();
    setSelectedEventId(null);
    setSelectedMlAlertId(null);
    setTrajectoryStartTime(null);
    simulationRef.current = now;
    setSimulationTime(now);
    setPlaying(true);
    setCameraMode(selectedSatelliteId ? 'follow' : 'global');
    setCameraResetKey((value) => value + 1);
  }

  const screeningCandidateCount = rankedEvents.filter((event) => event.priority === 'review' || event.priority === 'watch').length;
  const dataStatus = conjunctions?.status ?? catalog?.status;
  const namedEvents = rankedEvents.filter((event) => {
    const protectedId = chooseProtectedId(event);
    const counterpart = counterpartFor(event, protectedId);
    const threat = threatsById.get(counterpart.id);
    return threat && !/^UNKNOWN\b/i.test(threat.name);
  });
  const monitoredEvents = (namedEvents.length >= 6 ? namedEvents : rankedEvents).slice(0, 6);
  const triageMinute = Math.floor(clock / 60_000) * 60_000;
  const liveMlAlerts = useMemo(() => rankedEvents.flatMap((event) => {
    const result = scorePublicConjunction(event, triageMinute);
    if (!result || result.triage !== 'elevated') return [];
    if (!recordMap.has(event.primaryCatalogId) || !recordMap.has(event.secondaryCatalogId)) return [];
    if (/^UNKNOWN\b/i.test(cleanName(event.primaryName)) || /^UNKNOWN\b/i.test(cleanName(event.secondaryName))) return [];
    return [result];
  }).sort((first, second) => second.score - first.score || first.hoursToTca - second.hoursToTca), [rankedEvents, recordMap, triageMinute]);
  const mlAlertCount = liveMlAlerts.length;
  const selectedMlAlert = selectedMlAlertId
    ? liveMlAlerts.find((alert) => alert.event.id === selectedMlAlertId) ?? null
    : null;

  return <main className="ops-shell">
    <header className="ops-header">
      <div className="ops-brand"><span className="brand-glyph"><i /></span><div><strong>ORBITSHIELD</strong><small>ML conjunction risk predictor</small></div></div>
      <div className="ops-automation"><Radar size={15} /><span><strong>RISK PREDICTOR ACTIVE</strong><small>Live two-day ML triage</small></span></div>
      <div className="ops-header-summary"><span><b>{catalog?.count.toLocaleString() ?? 'N/A'}</b> active objects</span><i /><span><b>{screeningCandidateCount}</b> candidates</span><i /><span><b>{mlAlertCount}</b> ML alerts</span><i /><span><b>{modelBenchmark.models.length}</b> models tested</span></div>
      <button className="ops-refresh" onClick={() => void refreshLive(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Refreshing' : 'Refresh'}</button>
      <div className={`ops-feed-state ${statusTone(dataStatus)}`}><i /><span><b>{statusLabel(dataStatus)}</b><small>{lastRefresh ? formatIst(lastRefresh, { seconds: true }) : 'Connecting'}</small></span></div>
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

        <div className="ops-alert-heading model"><span><AlertTriangle size={13} /> LIVE ML RISK ALERTS</span><b>{mlAlertCount ? `${mlAlertCount} MODEL ELEVATED` : 'NO ELEVATED SCORE'}</b></div>
        <div className="ops-ml-alert-slot">
          {liveMlAlerts.slice(0, 2).map((alert) => {
            const protectedId = chooseProtectedId(alert.event);
            const counterpart = counterpartFor(alert.event, protectedId);
            const protectedName = cleanName(alert.event.primaryCatalogId === protectedId ? alert.event.primaryName : alert.event.secondaryName);
            return <button key={alert.event.id} className={selectedMlAlertId === alert.event.id ? 'selected' : ''} onClick={() => void selectEvent(alert.event, true, true)}>
              <span className="ops-alert-severity review"><Bot size={14} /></span>
              <span className="ops-alert-copy"><strong>{protectedName}</strong><small>↳ {cleanName(counterpart.name)}</small><em>ML score {alert.score.toFixed(3)} crossed {alert.threshold.toFixed(2)}.</em></span>
              <span className="ops-alert-metric"><b>{countdown(alert.event.tca, clock)}</b><small>{formatIst(alert.event.tca, { seconds: true })}</small></span>
            </button>;
          })}
          {!liveMlAlerts.length && <div className="ops-ml-alert-empty"><ShieldCheck size={14} /><span><strong>No elevated two-day alert</strong><small>The model rescans the current fleet feed every minute.</small></span></div>}
        </div>

        <div className="ops-alert-heading candidates"><span><Database size={13} /> PUBLIC SCREENING CANDIDATES</span><b>{screeningCandidateCount} WATCH OR REVIEW</b></div>
        <div className="ops-alert-list">
          {monitoredEvents.map((event) => {
            const protectedId = chooseProtectedId(event);
            const counterpart = counterpartFor(event, protectedId);
            const protectedName = cleanName(event.primaryCatalogId === protectedId ? event.primaryName : event.secondaryName);
            return <button key={event.id} className={`${selectedEventId === event.id ? 'selected' : ''} ${event.priority}`} onClick={() => void selectEvent(event, true)}>
              <span className={`ops-alert-severity ${event.priority}`}><TriangleAlert size={14} /></span>
              <span className="ops-alert-copy"><strong>{protectedName}</strong><small>↳ {cleanName(counterpart.name)}</small><em>{priorityReason(event)}</em></span>
              <span className="ops-alert-metric"><b>{countdown(event.tca, clock)}</b><small>{event.rangeKm?.toFixed(2) ?? 'N/A'} km</small></span>
            </button>;
          })}
        </div>
        <div className="ops-rail-footer"><CircleDot size={12} /><span><strong>Two-day model rescans every minute</strong><small>It scores TCA, current risk, miss distance and relative speed, then elevates the events that need analyst review.</small></span></div>
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
          playbackRate={1}
          contextTime={simulationTime}
          trajectoryStartTime={trajectoryStartTime}
          showCatalogue={catalogueVisible}
          focusSelectedOnly={false}
          showFleetLabels={!replayActive}
          replayPhase={replayPhase}
          replayActive={replayActive}
          replayFrameRef={replayFrameRef}
          onObjectSelect={selectFleetSatellite}
        />
        <div className="ops-globe-status">
          <span><i /> LIVE ORBITAL PICTURE</span>
          <strong>{selectedEvent ? `${cleanName(selectedEvent.primaryName)} ↔ ${cleanName(selectedEvent.secondaryName)}` : selectedObjectName ?? 'Fleet overview'}</strong>
          <small>{selectedEvent ? `${priorityLabels[selectedEvent.priority]} screening candidate · TCA ${formatIst(selectedEvent.tca, { seconds: true })}` : selectedRecord ? `${fleetIds.includes(Number(selectedRecord.NORAD_CAT_ID)) ? 'Monitored' : 'Catalogue'} satellite · NORAD ${selectedRecord.NORAD_CAT_ID}` : 'Select a satellite, screening candidate or ML alert'}</small>
        </div>
        <div className="ops-layer-legend"><span><i className="catalog" /> Catalogue satellites</span><span><i className="sat" /> Monitored satellites</span><span><i className="debris" /> Screened debris</span><span><i className="orbit" /> Monitored orbits</span></div>
        <EsaModelEvidence open={esaEvidenceOpen} onToggle={() => setEsaEvidenceOpen((value) => !value)} />
        {selectedEvent && <div className="ops-event-orbit-legend"><span><i className="protected" /> Protected approach to TCA</span><span><i className="counterpart" /> Counterpart approach to TCA</span><span><i className="tca-target" /> Closest approach</span></div>}
        {selectedEvent && selectedProtectedId && replayPhase === 'encounter' && <EncounterOverlay event={selectedEvent} protectedId={selectedProtectedId} threat={selectedThreat} />}
        <div className="ops-globe-controls">
          <div className="ops-time-control"><button onClick={() => { cancelReplay(); setPlaying((value) => !value); }} aria-label={playing ? 'Pause orbital animation' : 'Play orbital animation'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><span><b>LIVE CLOCK</b>{formatIst(simulationTime, { seconds: true })}</span></div>
          <div className="ops-camera-control"><button className={cameraMode === 'global' ? 'active' : ''} onClick={() => { setCameraMode('global'); setCameraResetKey((value) => value + 1); }}><RotateCcw size={13} /> Globe</button><button className={cameraMode === 'follow' || cameraMode === 'pair-follow' ? 'active' : ''} onClick={() => { setCameraMode(selectedEvent ? 'pair-follow' : 'follow'); setCameraResetKey((value) => value + 1); }} disabled={!selectedSatelliteId}><LocateFixed size={13} /> Track</button><button className={cameraMode === 'free' ? 'active' : ''} onClick={() => { setCameraMode('free'); setCameraResetKey((value) => value + 1); }}><Eye size={13} /> Free 3D</button><button className={catalogueVisible ? 'active' : ''} onClick={() => setCatalogueVisible((value) => !value)}><CircleDot size={13} /> Context</button></div>
          <button className="ops-tca-button" onClick={runTcaReplay} disabled={!selectedEvent || replayActive}><Crosshair size={15} /><span><strong>{replayActive ? `${replayPhase === 'follow' ? 'Following satellite' : replayPhase === 'acquire' ? 'Acquiring debris' : 'At closest approach'}` : 'Follow candidate to TCA'}</strong><small>{replayActive ? `≈ ${Math.round(replaySpeed)}× accelerated` : '20 minutes in 6.5 seconds'}</small></span></button>
          <button className="ops-live-button" onClick={returnLive}><Clock3 size={13} /> Now</button>
        </div>
      </section>

      <aside className="ops-analysis-rail">
        <div className="ops-analysis-heading"><div><span><Sparkles size={13} /> ORBITSHIELD ANALYST</span><strong>{selectedMlAlert ? 'Live ML alert' : selectedEvent ? 'Screening review' : selectedRecord ? 'Object profile' : 'ML risk predictor'}</strong></div><b>{selectedMlAlert ? <><Bot size={14} /> MODEL</> : selectedEvent ? <><Database size={14} /> PUBLIC DATA</> : selectedRecord ? <><Database size={14} /> CATALOGUE</> : <><Bot size={14} /> MODEL</>}</b></div>
        {selectedEvent && explanation && selectedCounterpart ? <>
          <section className={`ops-current-alert ${selectedEvent.priority}`}>
            <div><span>{selectedMlAlert ? <><Bot size={13} /> LIVE ML ELEVATED</> : <><TriangleAlert size={13} /> SCREENING CANDIDATE</>}</span><b className={selectedMlAlert ? 'review' : selectedEvent.priority}>{selectedMlAlert ? `SCORE ${selectedMlAlert.score.toFixed(3)}` : priorityLabels[selectedEvent.priority]}</b></div>
            <strong>{cleanName(selectedEvent.primaryCatalogId === selectedProtectedId ? selectedEvent.primaryName : selectedEvent.secondaryName)}</strong>
            <small>Possible conjunction with {cleanName(selectedCounterpart.name)} · NORAD {selectedCounterpart.id}</small>
          </section>

          <section className="ops-natural-language">
            <div className="ops-section-label"><span>NATURAL-LANGUAGE BRIEF</span><b><ShieldCheck size={11} /> VERIFIED FIELDS ONLY</b></div>
            <p>{explanation.whatIsHappening}</p>
            <strong>{explanation.whyPrioritized}</strong>
          </section>

          <section className="ops-risk-metrics">
            <div><span>TCA in IST</span><strong>{formatIst(selectedEvent.tca, { seconds: true, year: true })}</strong><small>{countdown(selectedEvent.tca, simulationTime)} from simulation time</small></div>
            <div><span>Miss range</span><strong>{metric(selectedEvent.rangeKm, 'km', 3)}</strong><small>SOCRATES reported</small></div>
            <div><span>Relative speed</span><strong>{metric(selectedEvent.relativeSpeedKmS, 'km/s', 3)}</strong><small>At TCA</small></div>
            <div><span>Maximum Pc</span><strong>{formatProbability(selectedEvent.maximumProbability)}</strong><small>Screening estimate</small></div>
          </section>

          <section className="ops-model-state">
            <div className="ops-section-label"><span>TWO-DAY MODEL INFERENCE</span><b className={selectedMlAlert ? 'ready' : 'waiting'}>{selectedMlAlert ? 'ELEVATED' : 'NOT ELEVATED'}</b></div>
            <div className="ops-model-flow"><span className="done"><CheckCircle2 size={13} /> Current feed</span><i /><span className="done"><CheckCircle2 size={13} /> Four live features</span><i /><span className={selectedMlAlert ? 'done' : ''}><Bot size={13} /> ML triage</span></div>
            {selectedMlAlert ? <div className="ops-public-model-metrics">
              <span><small>Model score</small><strong>{selectedMlAlert.score.toFixed(3)}</strong></span>
              <span><small>Threshold</small><strong>{selectedMlAlert.threshold.toFixed(2)}</strong></span>
              <span><small>Time to TCA</small><strong>{selectedMlAlert.hoursToTca.toFixed(1)} h</strong></span>
              <span><small>Input coverage</small><strong>{Math.round(selectedMlAlert.inputCoverage * 100)}%</strong></span>
            </div> : null}
            <p>{selectedMlAlert
              ? 'The deployed model scored this current event from time to TCA, present risk, miss distance and relative speed. Its elevated score places the event in the analyst queue.'
              : 'This event did not cross the deployed two-day model threshold, or its TCA is outside the current 48-hour inference window.'}</p>
            <details><summary>Model evidence and limits <ChevronDown size={13} /></summary><div className="ops-model-proof"><span><b>{PUBLIC_TRIAGE_MODEL.dataset.trainEvents.toLocaleString()}</b> train events</span><span><b>{PUBLIC_TRIAGE_MODEL.test.f2.toFixed(3)}</b> test F2</span><span><b>{PUBLIC_TRIAGE_MODEL.test.recall.toFixed(3)}</b> test recall</span></div><p>The Histogram Gradient Boosting model uses only four fields available in both the training archive and current screening feed. The event split keeps test events outside training. The score ranks review priority; it is not collision probability.</p></details>
          </section>

          <section className="ops-action-plan">
            <div className="ops-section-label"><span>RECOMMENDED WORKFLOW</span><b>HUMAN DECISION</b></div>
            <p className="ops-human-decision">A qualified operator checks fresher tracking and uncertainty, asks flight dynamics to verify the encounter, then chooses continued monitoring, operator coordination or a formal manoeuvre study. Human approval matters because every orbit change consumes mission resources and can create new conjunctions.</p>
            <ol>{explanation.recommendedSteps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}</ol>
          </section>

          <button className="ops-primary-action" onClick={runTcaReplay} disabled={replayActive}><Crosshair size={16} /><span><strong>{replayActive ? 'Following the encounter' : 'Visualize this candidate'}</strong><small>{replayActive ? `Replay running at about ${Math.round(replaySpeed)}×` : `Track both objects to ${formatIst(selectedEvent.tca, { seconds: true })}`}</small></span></button>
          <p className="ops-safety-note"><ShieldCheck size={13} /> OrbitShield recommends review steps, never manoeuvres. Qualified mission personnel retain every operational decision.</p>
        </> : selectedRecord && selectedSatelliteId ? <div className="ops-object-profile">
          <section className="ops-object-identity">
            <span><Satellite size={14} /> {fleetIds.includes(selectedSatelliteId) ? 'MONITORED SATELLITE' : 'ACTIVE CATALOGUE SATELLITE'}</span>
            <strong>{cleanName(selectedRecord.OBJECT_NAME)}</strong>
            <small>NORAD {selectedSatelliteId} · {selectedRecord.OBJECT_ID || 'International designator unavailable'}</small>
          </section>
          <p className="ops-object-summary">{selectedFleetSatellite
            ? `${selectedFleetSatellite.name} is monitored as part of the India Earth Observation fleet. Mission focus: ${selectedFleetSatellite.mission}.`
            : `${cleanName(selectedRecord.OBJECT_NAME)} is an active public-catalogue payload. OrbitShield shows verified orbital metadata and its current SGP4 position without treating it as part of the monitored fleet.`}</p>
          <section className="ops-object-grid">
            <div><span>Object type</span><strong>{selectedRecord.OBJECT_TYPE || selectedObjectThreat?.objectType || 'Payload'}</strong></div>
            <div><span>Owner code</span><strong>{selectedRecord.COUNTRY_CODE || selectedObjectThreat?.owner || 'Unavailable'}</strong></div>
            <div><span>Launch date</span><strong>{selectedRecord.LAUNCH_DATE || 'Unavailable'}</strong></div>
            <div><span>Inclination</span><strong>{Number.isFinite(Number(selectedRecord.INCLINATION)) ? `${Number(selectedRecord.INCLINATION).toFixed(2)}°` : 'Unavailable'}</strong></div>
            <div><span>Orbit period</span><strong>{Number(selectedRecord.MEAN_MOTION) > 0 ? `${(1_440 / Number(selectedRecord.MEAN_MOTION)).toFixed(1)} min` : 'Unavailable'}</strong></div>
            <div><span>Screening candidates</span><strong>{selectedObjectEvents.length}</strong></div>
          </section>
          <section className="ops-object-source">
            <div className="ops-section-label"><span>ORBIT RECORD</span><b><ShieldCheck size={11} /> VERIFIED FIELDS</b></div>
            <p>Element epoch: {formatIst(selectedRecord.EPOCH, { seconds: true, year: true })}. Position and orbit are propagated from this public {selectedRecord.TLE_LINE1 ? 'TLE' : 'OMM'} record using SGP4. Source: {selectedRecord.ORBIT_SOURCE ?? catalog?.source ?? 'public GP catalogue'}.</p>
          </section>
        </div> : <div className="ops-no-alert ops-monitoring-overview"><Radar size={25} /><strong>Live ML risk prediction is active</strong><p>The two-day model rescans every current fleet event and moves only elevated scores into the alert queue. Select an alert to follow the satellite pair to TCA.</p><div><span><b>{fleetIds.length}</b> monitored satellites</span><span><b>{screeningCandidateCount}</b> screening candidates</span><span><b>{mlAlertCount}</b> ML risk alerts</span></div></div>}
      </aside>
    </section>
  </main>;
}
