'use client';

import dynamic from 'next/dynamic';
import {
  Activity, AlertTriangle, Bot, CircleDot, Clock3,
  Crosshair, Database, Eye, Fuel, LocateFixed, Lock, Pause, Play, Plus,
  Radar, RotateCcw, Route, Satellite, Search, Settings2, ShieldCheck,
  Sparkles, TriangleAlert, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import fleetOrbitFixture from './data/fleet-orbits.snapshot.json';
import {
  animateTcaReplay, isSatelliteObjectType,
  TCA_REPLAY_DURATION_MS, tcaReplayStart, type TcaReplayFrame, type TcaReplayPhase,
} from './lib/collision-visualization';
import { explainConjunction } from './lib/explanations';
import { INDIA_EO_FLEET } from './lib/fleet';
import {
  eventForSatellite, eventTouchesMonitoringList, monitoredState,
  isFutureConjunction, normalizeMonitoringIds, priorityReason,
} from './lib/monitoring';
import {
  buildManeuverStudy, DEFAULT_MANEUVER_ASSUMPTIONS,
  sanitizeManeuverAssumptions, type ManeuverAssumptions,
  type ManeuverCandidate, type ManeuverStudy,
} from './lib/maneuver';
import { PUBLIC_TRIAGE_MODEL, scorePublicConjunction } from './lib/public-triage';
import { comparePriority, formatProbability } from './lib/screening';
import { advanceSimulationTime, formatIst } from './lib/time';
import type { OrbitCameraMode } from './orbit-globe';
import type {
  CatalogResponse, ConjunctionRecord, ConjunctionResponse, OmmRecord,
  FleetObject, ScreeningPriority, ThreatObject, ThreatResponse,
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
const defaultFleetIds = INDIA_EO_FLEET.objects.map((item) => item.catalogId);
const MONITORING_STORAGE_KEY = 'orbitshield.monitoring-list.v1';
const priorityLabels: Record<ScreeningPriority, string> = {
  review: 'Review', watch: 'Watch', low: 'Low', 'needs-data': 'Needs data',
};

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

function probabilityPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  const percent = value * 100;
  if (percent >= 1) return `${percent.toFixed(2)}%`;
  if (percent >= 0.01) return `${percent.toFixed(3)}%`;
  return `${percent.toFixed(6)}%`;
}

function counterpartFor(event: ConjunctionRecord, protectedId: number) {
  return event.primaryCatalogId === protectedId
    ? { id: event.secondaryCatalogId, name: event.secondaryName }
    : { id: event.primaryCatalogId, name: event.primaryName };
}

function EncounterOverlay({ event, protectedId, threat, maneuverCandidate }: {
  event: ConjunctionRecord;
  protectedId: number;
  threat?: ThreatObject;
  maneuverCandidate?: ManeuverCandidate | null;
}) {
  const counterpart = counterpartFor(event, protectedId);
  const type = threat?.objectType === 'R/B' ? 'ROCKET BODY' : isSatelliteObjectType(threat?.objectType) ? 'SATELLITE' : 'DEBRIS';
  const baselineRatio = maneuverCandidate && event.rangeKm
    ? Math.min(100, Math.max(4, event.rangeKm / maneuverCandidate.separationAtSourceTcaKm * 100))
    : 100;
  return <div className="ops-encounter-overlay" aria-label="Magnified closest-approach view">
    <div className="ops-encounter-head"><span><i /> TCA TARGET · CLOSEST APPROACH</span><b>MAGNIFIED, NOT TO EARTH SCALE</b></div>
    <div className="ops-encounter-geometry">
      <span className="ops-protected"><Satellite size={18} /><b>{cleanName(event.primaryCatalogId === protectedId ? event.primaryName : event.secondaryName)}</b></span>
      <i><strong>{metric(event.rangeKm, 'km', 3)}</strong><small>reported miss range</small></i>
      <span className="ops-counterpart"><em /><b>{type}</b><small>{cleanName(counterpart.name)}</small></span>
    </div>
    {maneuverCandidate && <div className="ops-avoidance-comparison">
      <span><b>NO BURN</b><i><em style={{ width: `${baselineRatio}%` }} /></i><strong>{metric(event.rangeKm, 'km', 3)}</strong></span>
      <span className="candidate"><b>HCW PREVIEW</b><i><em /></i><strong>{maneuverCandidate.separationAtSourceTcaKm.toFixed(3)} km</strong></span>
      <small>+{maneuverCandidate.separationGainAtSourceTcaKm.toFixed(2)} km at the original TCA. Post-manoeuvre Pc still requires CDM validation.</small>
    </div>}
  </div>;
}

function downloadManeuverCandidate(
  event: ConjunctionRecord,
  candidate: ManeuverCandidate,
  assumptions: ManeuverAssumptions,
  study: ManeuverStudy,
) {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    purpose: 'Advisory flight-dynamics review only',
    event,
    candidate,
    examplePropulsionProfile: assumptions,
    method: study.method,
    requiredChecks: study.requiredChecks,
    validation: {
      covarianceBackedProbability: 'unavailable',
      probabilityStatus: study.probabilityStatus,
      fullCatalogueRescreen: 'not-run',
      operatorApproval: 'required',
    },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `orbitshield-manoeuvre-${event.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ManeuverStudyPanel({
  event,
  protectedRecord,
  counterpartRecord,
  now,
  onCandidateChange,
}: {
  event: ConjunctionRecord;
  protectedRecord: OmmRecord | null | undefined;
  counterpartRecord: OmmRecord | null | undefined;
  now: number;
  onCandidateChange: (candidate: ManeuverCandidate | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assumptions, setAssumptions] = useState(DEFAULT_MANEUVER_ASSUMPTIONS);
  const [drafts, setDrafts] = useState<Partial<Record<keyof ManeuverAssumptions, string>>>({});
  const study = useMemo(() => buildManeuverStudy({
    event,
    protectedRecord,
    counterpartRecord,
    now,
    assumptions,
  }), [assumptions, counterpartRecord, event, now, protectedRecord]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const candidates = useMemo(() => [study.recommended, ...study.alternatives].filter((candidate): candidate is ManeuverCandidate => Boolean(candidate)), [study]);
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? study.recommended;

  function updateAssumption(key: keyof ManeuverAssumptions, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    if (!value.trim() || !Number.isFinite(Number(value))) return;
    const next = sanitizeManeuverAssumptions({ ...assumptions, [key]: Number(value) });
    setAssumptions(next);
    setSelectedCandidateId(null);
    const nextStudy = buildManeuverStudy({ event, protectedRecord, counterpartRecord, now, assumptions: next });
    onCandidateChange(expanded ? nextStudy.recommended : null);
  }

  function commitAssumption(key: keyof ManeuverAssumptions) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  return <section className={`ops-maneuver-study ${expanded ? 'expanded' : ''}`}>
    <div className="ops-section-label"><span>ADVISORY MANOEUVRE STUDY</span>{expanded ? <button className="ops-study-collapse" onClick={() => { setExpanded(false); onCandidateChange(null); }}>Collapse</button> : <b><Route size={11} /> PHYSICS PREVIEW</b>}</div>
    {!expanded ? <>
      <p>Compare small R-T-N burns by modeled path separation and propellant before sending one candidate to flight dynamics.</p>
      <button className="ops-study-launch" onClick={() => { setExpanded(true); onCandidateChange(study.recommended); }} disabled={study.status !== 'ready'}>
        <Route size={15} /><span><strong>{study.status === 'ready' ? 'Study avoidance options' : 'Study unavailable'}</strong><small>{study.status === 'ready' ? `R-T-N sweep using the available T−${study.recommended?.leadHours ?? 0} h planning window` : study.reason}</small></span>
      </button>
    </> : <>
      <div className="ops-study-banner"><ShieldCheck size={14} /><span><strong>Candidate for review, not a spacecraft command</strong><small>Operator validation and a full-catalogue re-screen remain mandatory.</small></span></div>
      {selectedCandidate ? <>
        <div className="ops-study-candidate-head">
          <span><small>LOWEST-IMPULSE CANDIDATE MEETING THE GEOMETRY GOAL</small><strong>{selectedCandidate.direction} · {selectedCandidate.deltaVMps.toFixed(2)} m/s</strong><em>{selectedCandidate.directionLabel} · equivalent impulse {selectedCandidate.leadHours} h before TCA</em></span>
          <b>{selectedCandidate.propellantGrams.toFixed(1)} g<small>for the {assumptions.spacecraftMassKg.toLocaleString('en-IN')} kg example profile</small></b>
        </div>
        <div className="ops-study-geometry" aria-label={`Source separation ${metric(event.rangeKm, 'kilometres', 3)}. Candidate separation ${selectedCandidate.separationAtSourceTcaKm.toFixed(3)} kilometres at the original TCA.`}>
          <span className="baseline"><i /><b>{metric(event.rangeKm, 'km', 3)}</b><small>source separation at TCA</small></span>
          <em><Route size={13} /> +{selectedCandidate.separationGainAtSourceTcaKm.toFixed(2)} km</em>
          <span className="candidate"><i /><b>{selectedCandidate.separationAtSourceTcaKm.toFixed(3)} km</b><small>candidate separation at original TCA</small></span>
        </div>
        <div className="ops-study-metrics">
          <span><small>Equivalent impulse epoch</small><strong>{formatIst(selectedCandidate.burnTime, { seconds: true })}</strong></span>
          <span><small>Path displacement at source TCA</small><strong>{selectedCandidate.displacementAtTcaKm.toFixed(2)} km</strong></span>
          <span><small>Estimated thrust time</small><strong>{selectedCandidate.burnDurationSeconds.toFixed(2)} s</strong></span>
          <span className="locked"><small>Post-manoeuvre Pc</small><strong><Lock size={10} /> CDM required</strong></span>
        </div>
        <div className="ops-pc-gate"><Lock size={13} /><span><strong>Probability change requires professional data</strong><small>{study.probabilityStatus}</small></span></div>
        {candidates.length > 1 && <details className="ops-study-disclosure"><summary>Compare two alternatives</summary><div className="ops-study-alternatives">{candidates.map((candidate) => <button key={candidate.id} aria-pressed={candidate.id === selectedCandidate.id} className={candidate.id === selectedCandidate.id ? 'selected' : ''} onClick={() => { setSelectedCandidateId(candidate.id); onCandidateChange(candidate); }}><b>{candidate.direction} · {candidate.deltaVMps.toFixed(2)} m/s</b><small>+{candidate.separationGainAtSourceTcaKm.toFixed(1)} km at source TCA · {candidate.propellantGrams.toFixed(1)} g</small></button>)}</div></details>}
        <details className="ops-study-disclosure"><summary>Validation gates</summary><div className="ops-study-checks"><span><i className="ready" /> Linearized RTN geometry modeled</span><span><i /> Covariance-backed Pc unavailable</span><span><i /> Full-catalogue re-screen not run</span><span><i /> Operator approval required</span></div></details>
        <button className="ops-study-export" onClick={() => downloadManeuverCandidate(event, selectedCandidate, assumptions, study)}><Fuel size={14} /><span><strong>Export for flight-dynamics review</strong><small>Method, assumptions, geometry and validation gates in JSON</small></span></button>
      </> : <p className="ops-study-unavailable">{study.reason}</p>}
      <details className="ops-study-disclosure"><summary><Settings2 size={12} /> Edit example propulsion profile</summary><div className="ops-study-assumptions">
        <label>Mass, kg<input type="number" value={drafts.spacecraftMassKg ?? assumptions.spacecraftMassKg} onChange={(event) => updateAssumption('spacecraftMassKg', event.target.value)} onBlur={() => commitAssumption('spacecraftMassKg')} /></label>
        <label>Isp, s<input type="number" value={drafts.specificImpulseSeconds ?? assumptions.specificImpulseSeconds} onChange={(event) => updateAssumption('specificImpulseSeconds', event.target.value)} onBlur={() => commitAssumption('specificImpulseSeconds')} /></label>
        <label>Thrust, N<input type="number" value={drafts.thrustNewtons ?? assumptions.thrustNewtons} onChange={(event) => updateAssumption('thrustNewtons', event.target.value)} onBlur={() => commitAssumption('thrustNewtons')} /></label>
        <label>Separation-gain goal, km<input type="number" step="0.1" value={drafts.targetSeparationGainKm ?? assumptions.targetSeparationGainKm} onChange={(event) => updateAssumption('targetSeparationGainKm', event.target.value)} onBlur={() => commitAssumption('targetSeparationGainKm')} /></label>
        <p>Example values only. Replace them with the controlled spacecraft profile before review.</p>
      </div></details>
    </>}
  </section>;
}

export default function OperationsWorkspace() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [conjunctions, setConjunctions] = useState<ConjunctionResponse | null>(null);
  const [threats, setThreats] = useState<ThreatResponse | null>(null);
  const [liveRefreshFailed, setLiveRefreshFailed] = useState(false);
  const [extraRecords, setExtraRecords] = useState<OmmRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<number | null>(null);
  const [simulationTime, setSimulationTime] = useState(0);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [cameraMode, setCameraMode] = useState<OrbitCameraMode>('global');
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [replayActive, setReplayActive] = useState(false);
  const [replayPhase, setReplayPhase] = useState<TcaReplayPhase | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(0);
  const [catalogueVisible, setCatalogueVisible] = useState(true);
  const [trajectoryStartTime, setTrajectoryStartTime] = useState<number | null>(null);
  const [selectedMlAlertId, setSelectedMlAlertId] = useState<string | null>(null);
  const [pendingGlobeReplayId, setPendingGlobeReplayId] = useState<string | null>(null);
  const [monitoredIds, setMonitoredIds] = useState(defaultFleetIds);
  const [monitoringReady, setMonitoringReady] = useState(false);
  const [fleetManagerOpen, setFleetManagerOpen] = useState(false);
  const [fleetSearch, setFleetSearch] = useState('');
  const [selectedManeuverCandidate, setSelectedManeuverCandidate] = useState<ManeuverCandidate | null>(null);
  const simulationRef = useRef(0);
  const lastTick = useRef(0);
  const replayCancel = useRef<(() => void) | null>(null);
  const replayFrameRef = useRef<TcaReplayFrame | null>(null);
  const replayPhaseRef = useRef<TcaReplayPhase | null>(null);
  const replayClockValueRef = useRef<HTMLElement | null>(null);
  const lastReplayClockPaintRef = useRef(0);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const persisted = window.localStorage.getItem(MONITORING_STORAGE_KEY);
        if (persisted) {
          const parsed: unknown = JSON.parse(persisted);
          if (Array.isArray(parsed)) setMonitoredIds(normalizeMonitoringIds(parsed));
        }
      } catch {
        // The default list remains available if device storage is unavailable.
      } finally {
        setMonitoringReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!monitoringReady) return;
    try {
      window.localStorage.setItem(MONITORING_STORAGE_KEY, JSON.stringify(monitoredIds));
    } catch {
      // Monitoring remains usable for the current session.
    }
  }, [monitoredIds, monitoringReady]);

  const refreshLive = useCallback(async () => {
    try {
      const result = await fetch('/api/live');
      if (!result.ok) throw new Error(`Live refresh failed with HTTP ${result.status}`);
      const response = await result.json() as {
        conjunctions: ConjunctionResponse;
        threats: ThreatResponse;
        refreshedAt: string;
      };
      setConjunctions(response.conjunctions);
      setThreats(response.threats);
      setLiveRefreshFailed(false);
    } catch {
      setLiveRefreshFailed(true);
      // Keep the last current or cached monitoring snapshot available.
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/catalog?group=active')
      .then((response) => {
        if (!response.ok) throw new Error(`Catalogue request failed with HTTP ${response.status}`);
        return response.json() as Promise<CatalogResponse>;
      })
      .then((result) => { if (active) setCatalog(result); })
      .catch(() => { if (active) setCatalog({ status: 'unavailable', source: 'Catalogue unavailable', sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), count: 0, objects: [] }); });
    fetch('/api/bootstrap')
      .then((response) => {
        if (!response.ok) throw new Error(`Bootstrap request failed with HTTP ${response.status}`);
        return response.json() as Promise<{ conjunctions: ConjunctionResponse; threats: ThreatResponse; refreshedAt: string }>;
      })
      .then((result) => {
        if (!active) return;
        setConjunctions(result.conjunctions);
        setThreats(result.threats);
      })
      .catch(() => { if (active) setLiveRefreshFailed(true); })
      .finally(() => { if (active) void refreshLive(); });
    const interval = window.setInterval(() => void refreshLive(), 5 * 60_000);
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
    }, 500);
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
  const monitoredIdSet = useMemo(() => new Set(monitoredIds), [monitoredIds]);
  const triageMinute = Math.floor(clock / 60_000) * 60_000;
  const rankedEvents = useMemo(() => [...(conjunctions?.events ?? [])]
    .filter((event) => eventTouchesMonitoringList(event, monitoredIdSet))
    .filter((event) => !triageMinute || isFutureConjunction(event, triageMinute))
    .sort(comparePriority), [conjunctions, monitoredIdSet, triageMinute]);

  const monitoredFleetObjects = useMemo<FleetObject[]>(() => {
    const defaults = new Map(INDIA_EO_FLEET.objects.map((item) => [item.catalogId, item]));
    return monitoredIds.map((catalogId) => {
      const known = defaults.get(catalogId);
      if (known) return known;
      const record = recordMap.get(catalogId);
      const name = cleanName(record?.OBJECT_NAME ?? `NORAD ${catalogId}`);
      return {
        catalogId,
        name,
        shortName: name,
        mission: record?.COUNTRY_CODE ? `${record.COUNTRY_CODE} active payload` : 'Custom monitored payload',
      };
    });
  }, [monitoredIds, recordMap]);

  const fleetSearchResults = useMemo(() => {
    const query = fleetSearch.trim().toLowerCase();
    if (!query) return [];
    return (catalog?.objects ?? [])
      .filter((record) => {
        const catalogId = Number(record.NORAD_CAT_ID);
        if (monitoredIdSet.has(catalogId)) return false;
        const objectType = record.OBJECT_TYPE?.toUpperCase();
        if (objectType && objectType !== 'PAY' && objectType !== 'PAYLOAD') return false;
        return String(catalogId).includes(query) || record.OBJECT_NAME.toLowerCase().includes(query);
      })
      .slice(0, 6);
  }, [catalog, fleetSearch, monitoredIdSet]);

  const chooseProtectedId = useCallback((event: ConjunctionRecord) => {
    if (monitoredIdSet.has(event.primaryCatalogId)) return event.primaryCatalogId;
    if (monitoredIdSet.has(event.secondaryCatalogId)) return event.secondaryCatalogId;
    return event.primaryCatalogId;
  }, [monitoredIdSet]);

  const selectEvent = useCallback(async (event: ConjunctionRecord, startReplay = false, modelAlert = false) => {
    replayCancel.current?.();
    replayCancel.current = null;
    setReplayActive(false);
    setReplayPhase(null);
    setSelectedMlAlertId(modelAlert ? event.id : null);
    setSelectedManeuverCandidate(null);
    setCatalogueVisible(false);
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
  const selectedFleetSatellite = selectedSatelliteId ? monitoredFleetObjects.find((item) => item.catalogId === selectedSatelliteId) : undefined;
  const selectedRecord = selectedSatelliteId ? recordMap.get(selectedSatelliteId) : undefined;
  const selectedObjectThreat = selectedSatelliteId ? threatsById.get(selectedSatelliteId) : undefined;
  const selectedObjectName = selectedRecord?.OBJECT_NAME ?? selectedObjectThreat?.name ?? selectedFleetSatellite?.name;
  const selectedObjectEvents = useMemo(() => selectedSatelliteId
    ? rankedEvents.filter((event) => event.primaryCatalogId === selectedSatelliteId || event.secondaryCatalogId === selectedSatelliteId)
    : [], [rankedEvents, selectedSatelliteId]);
  const explanation = selectedEvent ? explainConjunction(selectedEvent) : null;
  const focusRecords = useMemo(() => {
    const ids = new Set([
      ...monitoredIds,
      ...(selectedEvent ? [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId] : []),
      ...(selectedSatelliteId ? [selectedSatelliteId] : []),
    ]);
    return [...ids].flatMap((id) => recordMap.get(id) ?? []);
  }, [monitoredIds, recordMap, selectedEvent, selectedSatelliteId]);

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
        const paintTime = performance.now();
        if (replayClockValueRef.current && paintTime - lastReplayClockPaintRef.current >= 200) {
          replayClockValueRef.current.textContent = formatIst(frame.simulationTime, { seconds: true });
          lastReplayClockPaintRef.current = paintTime;
        }
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

  function selectObject(catalogId: number) {
    cancelReplay();
    setPendingGlobeReplayId(null);
    setSelectedMlAlertId(null);
    setSelectedManeuverCandidate(null);
    setSelectedEventId(null);
    setTrajectoryStartTime(null);
    setCatalogueVisible(true);
    setSelectedSatelliteId(catalogId);
    setCameraMode('follow');
    setCameraResetKey((value) => value + 1);
  }

  function addMonitoredSatellite(catalogId: number) {
    setMonitoredIds((current) => normalizeMonitoringIds([...current, catalogId]));
    setFleetSearch('');
    setFleetManagerOpen(false);
    selectObject(catalogId);
  }

  function removeMonitoredSatellite(catalogId: number) {
    setMonitoredIds((current) => current.filter((id) => id !== catalogId));
    if (selectedEvent && (selectedEvent.primaryCatalogId === catalogId || selectedEvent.secondaryCatalogId === catalogId)) {
      cancelReplay();
      setSelectedEventId(null);
      setSelectedMlAlertId(null);
      setSelectedManeuverCandidate(null);
      setTrajectoryStartTime(null);
    }
  }

  function resetMonitoringList() {
    setMonitoredIds(defaultFleetIds);
    setFleetSearch('');
  }

  function returnLive() {
    cancelReplay();
    setPendingGlobeReplayId(null);
    const now = Date.now();
    setSelectedEventId(null);
    setSelectedMlAlertId(null);
    setSelectedManeuverCandidate(null);
    setTrajectoryStartTime(null);
    setCatalogueVisible(true);
    simulationRef.current = now;
    setSimulationTime(now);
    setPlaying(true);
    setCameraMode(selectedSatelliteId ? 'follow' : 'global');
    setCameraResetKey((value) => value + 1);
  }

  const screeningCandidateCount = rankedEvents.filter((event) => event.priority === 'review' || event.priority === 'watch').length;
  const namedEvents = rankedEvents.filter((event) => {
    const protectedId = chooseProtectedId(event);
    const counterpart = counterpartFor(event, protectedId);
    const threat = threatsById.get(counterpart.id);
    return threat && !/^UNKNOWN\b/i.test(threat.name);
  });
  const liveMlAlerts = useMemo(() => rankedEvents.flatMap((event) => {
    const result = scorePublicConjunction(event, triageMinute);
    if (!result || result.triage !== 'elevated') return [];
    if (!recordMap.has(event.primaryCatalogId) || !recordMap.has(event.secondaryCatalogId)) return [];
    if (/^UNKNOWN\b/i.test(cleanName(event.primaryName)) || /^UNKNOWN\b/i.test(cleanName(event.secondaryName))) return [];
    return [result];
  }).sort((first, second) => {
    const firstPlanningWindow = first.hoursToTca >= 24 && first.hoursToTca <= 48 ? 0 : 1;
    const secondPlanningWindow = second.hoursToTca >= 24 && second.hoursToTca <= 48 ? 0 : 1;
    const firstProtectedId = chooseProtectedId(first.event);
    const secondProtectedId = chooseProtectedId(second.event);
    const firstCounterpart = counterpartFor(first.event, firstProtectedId);
    const secondCounterpart = counterpartFor(second.event, secondProtectedId);
    const firstType = threatsById.get(firstCounterpart.id)?.objectType;
    const secondType = threatsById.get(secondCounterpart.id)?.objectType;
    const firstDebris = firstType && !isSatelliteObjectType(firstType) ? 0 : 1;
    const secondDebris = secondType && !isSatelliteObjectType(secondType) ? 0 : 1;
    const firstProbability = first.event.maximumProbability ?? -1;
    const secondProbability = second.event.maximumProbability ?? -1;
    return firstPlanningWindow - secondPlanningWindow
      || firstDebris - secondDebris
      || secondProbability - firstProbability
      || second.score - first.score
      || first.hoursToTca - second.hoursToTca;
  }), [chooseProtectedId, rankedEvents, recordMap, threatsById, triageMinute]);
  const mlAlertCount = liveMlAlerts.length;
  const primaryMlAlert = liveMlAlerts[0] ?? null;
  const monitoredEvents = (namedEvents.length >= 6 ? namedEvents : rankedEvents)
    .filter((event) => event.id !== primaryMlAlert?.event.id)
    .slice(0, 4);
  const primaryMlProtectedId = primaryMlAlert ? chooseProtectedId(primaryMlAlert.event) : null;
  const primaryMlCounterpart = primaryMlAlert && primaryMlProtectedId ? counterpartFor(primaryMlAlert.event, primaryMlProtectedId) : null;
  const primaryMlProtectedName = primaryMlAlert && primaryMlProtectedId
    ? cleanName(primaryMlAlert.event.primaryCatalogId === primaryMlProtectedId ? primaryMlAlert.event.primaryName : primaryMlAlert.event.secondaryName)
    : null;
  const selectPrimaryMlAlert = useCallback(() => {
    if (primaryMlAlert) void selectEvent(primaryMlAlert.event, true, true);
  }, [primaryMlAlert, selectEvent]);
  const selectedMlAlert = selectedMlAlertId
    ? liveMlAlerts.find((alert) => alert.event.id === selectedMlAlertId) ?? null
    : null;
  const selectedProtectedRecord = selectedEvent && selectedProtectedId ? recordMap.get(selectedProtectedId) : null;
  const selectedCounterpartRecord = selectedCounterpart ? recordMap.get(selectedCounterpart.id) : null;
  const feedTone = liveRefreshFailed ? 'cached' : conjunctions?.status ?? 'unavailable';
  const feedLabel = liveRefreshFailed
    ? 'LAST SUCCESSFUL FEED'
    : conjunctions?.status === 'current'
    ? 'CURRENT PUBLIC FEED'
    : conjunctions?.status === 'cached'
      ? 'CACHED DEMO FEED'
      : 'PUBLIC FEED UNAVAILABLE';

  return <main className="ops-shell">
    <section className="ops-workspace">
      <aside className="ops-monitor-rail" aria-label="Monitoring fleet and conjunction queues">
        <div className="ops-panel-heading"><div><span>MONITORING FLEET</span><strong>Selected satellites</strong></div><div className="ops-panel-actions"><b><Activity size={12} /> {monitoredIds.length} MONITORED</b><button aria-label="Manage monitoring list" aria-expanded={fleetManagerOpen} aria-controls="monitoring-list-manager" className={fleetManagerOpen ? 'active' : ''} onClick={() => setFleetManagerOpen((value) => !value)}><Plus size={13} /></button></div></div>
        {fleetManagerOpen && <div className="ops-fleet-manager" id="monitoring-list-manager">
          <div><Search size={13} /><input aria-label="Search active satellites to monitor" autoFocus value={fleetSearch} onChange={(event) => setFleetSearch(event.target.value)} placeholder="Satellite name or NORAD id" /><button aria-label="Close monitoring manager" onClick={() => setFleetManagerOpen(false)}><X size={12} /></button></div>
          <p>Add an active payload to this device-local list. Orbit context is immediate; conjunction coverage for new assets requires a configured screening or CDM connector.</p>
          <div className="ops-fleet-search-results">
            {fleetSearchResults.map((record) => <button key={record.NORAD_CAT_ID} onClick={() => addMonitoredSatellite(Number(record.NORAD_CAT_ID))}><span><strong>{cleanName(record.OBJECT_NAME)}</strong><small>NORAD {record.NORAD_CAT_ID} · {record.COUNTRY_CODE || 'owner unavailable'}</small></span><Plus size={13} /></button>)}
            {fleetSearch.trim() && !fleetSearchResults.length && <small>No unmonitored active payload matched this search.</small>}
          </div>
          <button className="ops-reset-fleet" onClick={resetMonitoringList}><RotateCcw size={12} /> Reset six-satellite demo list</button>
        </div>}
        <div className="ops-fleet-list">
          {monitoredFleetObjects.map((satellite) => {
            const event = eventForSatellite(rankedEvents, satellite.catalogId);
            const state = monitoredState(event, defaultFleetIds.includes(satellite.catalogId));
            return <div key={satellite.catalogId} className={selectedSatelliteId === satellite.catalogId ? 'selected' : ''}>
              <button className="ops-fleet-select" onClick={() => selectObject(satellite.catalogId)}>
                <span className="ops-sat-icon"><Satellite size={15} /></span>
                <span className="ops-sat-copy"><strong>{satellite.shortName}</strong><small>NORAD {satellite.catalogId} · {satellite.mission}</small></span>
                <span className={`ops-sat-state ${state.tone}`}><i />{state.label}</span>
              </button>
              <button className="ops-fleet-remove" aria-label={`Remove ${satellite.shortName} from monitoring`} onClick={() => removeMonitoredSatellite(satellite.catalogId)}><X size={11} /></button>
            </div>;
          })}
          {!monitoredFleetObjects.length && <div className="ops-fleet-empty"><Satellite size={15} /><span><strong>No satellites monitored</strong><small>Use + to add an active payload or reset the demo list.</small></span></div>}
        </div>

        <div className="ops-alert-heading model"><span><AlertTriangle size={13} /> ML REVIEW ALERT</span><b>{mlAlertCount ? `1 PRIMARY · ${Math.max(0, mlAlertCount - 1)} QUEUED` : 'NO ELEVATED SCORE'}</b></div>
        <div className="ops-ml-alert-slot">
          {primaryMlAlert && primaryMlCounterpart && primaryMlProtectedName ? <button className={selectedMlAlertId === primaryMlAlert.event.id ? 'selected' : ''} onClick={selectPrimaryMlAlert}>
              <span className="ops-alert-severity review"><Bot size={14} /></span>
              <span className="ops-alert-copy"><strong>{primaryMlProtectedName}</strong><small>↳ {cleanName(primaryMlCounterpart.name)}</small><em>Max Pc {probabilityPercent(primaryMlAlert.event.maximumProbability)} · model requires review</em></span>
              <span className="ops-alert-metric"><b>{countdown(primaryMlAlert.event.tca, clock)}</b><small>{formatIst(primaryMlAlert.event.tca, { seconds: true })}</small></span>
            </button> : <div className="ops-ml-alert-empty"><ShieldCheck size={14} /><span><strong>No elevated two-day alert</strong><small>The model rescans the loaded monitoring feed every minute.</small></span></div>}
        </div>

        <div className="ops-alert-heading candidates"><span><Database size={13} /> PUBLIC SCREENING CANDIDATES</span><b>TOP {monitoredEvents.length} OF {screeningCandidateCount}</b></div>
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
        <div className={`ops-rail-footer ${feedTone}`} aria-live="polite"><CircleDot size={12} /><span><strong>{feedLabel}</strong><small>{conjunctions?.sourceUpdatedAt ? `Source timestamp ${formatIst(conjunctions.sourceUpdatedAt, { seconds: true, year: true })}. ` : ''}The model rescans the loaded future events every minute.</small></span></div>
      </aside>

      <section className="ops-globe-stage">
        <OrbitGlobe
          catalogue={catalog?.objects ?? []}
          focusRecords={focusRecords}
          threats={threats?.objects ?? []}
          fleetIds={monitoredIds}
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
          focusSelectedOnly={Boolean(selectedEvent)}
          showFleetLabels={!replayActive}
          replayPhase={replayPhase}
          replayActive={replayActive}
          replayFrameRef={replayFrameRef}
          maneuverCandidate={selectedManeuverCandidate}
          onObjectSelect={selectObject}
        />
        <div className="ops-globe-status">
          <span className={feedTone}><i /> {feedLabel}</span>
          <strong>{selectedEvent ? `${cleanName(selectedEvent.primaryName)} ↔ ${cleanName(selectedEvent.secondaryName)}` : selectedObjectName ?? 'Fleet overview'}</strong>
          <small>{selectedEvent ? `${priorityLabels[selectedEvent.priority]} screening candidate · TCA ${formatIst(selectedEvent.tca, { seconds: true })}` : selectedRecord ? `${monitoredIdSet.has(Number(selectedRecord.NORAD_CAT_ID)) ? 'Monitored' : 'Catalogue'} satellite · NORAD ${selectedRecord.NORAD_CAT_ID}` : 'Select a satellite, screening candidate or ML alert'} · Orbit elements {catalog?.status ?? 'loading'}</small>
        </div>
        <div className="ops-layer-legend"><span><i className="catalog" /> Catalogue satellites</span><span><i className="sat" /> Monitored satellites</span><span><i className="debris" /> Screened debris</span><span><i className="orbit" /> Monitored orbits</span></div>
        {selectedEvent && <div className="ops-event-orbit-legend"><span><i className="protected" /> Protected approach to TCA</span><span><i className="counterpart" /> Counterpart approach to TCA</span>{selectedManeuverCandidate && <span><i className="maneuver" /> Linearized HCW path preview</span>}<span><i className="tca-target" /> Closest approach</span></div>}
        {selectedEvent && selectedProtectedId && replayPhase === 'encounter' && <EncounterOverlay event={selectedEvent} protectedId={selectedProtectedId} threat={selectedThreat} maneuverCandidate={selectedManeuverCandidate} />}
        <div className="ops-globe-controls">
          <div className="ops-time-control"><button disabled={replayActive} onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause orbital animation' : 'Play orbital animation'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><span><b>{replayActive ? 'REPLAY TIME' : 'SIMULATION TIME'}</b><em ref={replayClockValueRef}>{formatIst(simulationTime, { seconds: true })}</em></span></div>
          <div className="ops-camera-control"><button aria-pressed={cameraMode === 'global'} className={cameraMode === 'global' ? 'active' : ''} onClick={() => { setCameraMode('global'); setCameraResetKey((value) => value + 1); }}><RotateCcw size={13} /> Globe</button><button aria-pressed={cameraMode === 'follow' || cameraMode === 'pair-follow'} className={cameraMode === 'follow' || cameraMode === 'pair-follow' ? 'active' : ''} onClick={() => { setCameraMode(selectedEvent ? 'pair-follow' : 'follow'); setCameraResetKey((value) => value + 1); }} disabled={!selectedSatelliteId}><LocateFixed size={13} /> Track</button><button aria-pressed={cameraMode === 'free'} className={cameraMode === 'free' ? 'active' : ''} onClick={() => { setCameraMode('free'); setCameraResetKey((value) => value + 1); }}><Eye size={13} /> Free 3D</button><button aria-pressed={catalogueVisible} className={catalogueVisible ? 'active' : ''} onClick={() => setCatalogueVisible((value) => !value)}><CircleDot size={13} /> Context</button></div>
          <button className="ops-tca-button" onClick={runTcaReplay} disabled={!selectedEvent || replayActive}><Crosshair size={15} /><span><strong>{replayActive ? `${replayPhase === 'follow' ? 'Following satellite' : replayPhase === 'acquire' ? 'Acquiring counterpart' : 'At closest approach'}` : 'Replay close approach'}</strong><small>{replayActive ? `≈ ${Math.round(replaySpeed)}× accelerated` : 'Follow both objects through the final 20 minutes'}</small></span></button>
          <button className="ops-live-button" onClick={returnLive}><Clock3 size={13} /> Now</button>
        </div>
      </section>

      <aside className="ops-analysis-rail" aria-label="OrbitShield analysis and advisory panel">
        <div className="ops-analysis-heading"><div><span><Sparkles size={13} /> ORBITSHIELD ANALYST</span><strong>{selectedMlAlert ? 'ML-prioritized review' : selectedEvent ? 'Screening review' : selectedRecord ? 'Object profile' : 'ML review prioritizer'}</strong></div><b>{selectedMlAlert ? <><Bot size={14} /> MODEL</> : selectedEvent ? <><Database size={14} /> PUBLIC DATA</> : selectedRecord ? <><Database size={14} /> CATALOGUE</> : <><Bot size={14} /> MODEL</>}</b></div>
        {selectedEvent && explanation && selectedCounterpart ? <>
          <section className={`ops-current-alert ${selectedEvent.priority}`}>
            <div><span>{selectedMlAlert ? <><Bot size={13} /> ML ELEVATED</> : <><TriangleAlert size={13} /> SCREENING CANDIDATE</>}</span><b className={selectedMlAlert ? 'review' : selectedEvent.priority}>{selectedMlAlert ? `SCORE ${selectedMlAlert.score.toFixed(3)}` : priorityLabels[selectedEvent.priority]}</b></div>
            <strong>{cleanName(selectedEvent.primaryCatalogId === selectedProtectedId ? selectedEvent.primaryName : selectedEvent.secondaryName)}</strong>
            <small>Possible conjunction with {cleanName(selectedCounterpart.name)} · NORAD {selectedCounterpart.id}</small>
          </section>

          <section className="ops-natural-language">
            <div className="ops-section-label"><span>BRIEF</span><b><ShieldCheck size={11} /> VERIFIED DATA</b></div>
            <p>CelesTrak reports a conservative maximum-Pc screening metric of {probabilityPercent(selectedEvent.maximumProbability)} for this close approach.</p>
            <strong>{selectedMlAlert
              ? `OrbitShield scored ${selectedMlAlert.score.toFixed(3)}, above the ${selectedMlAlert.threshold.toFixed(2)} review threshold. Review means obtaining a current CDM, checking uncertainty and deciding whether to monitor, coordinate or study a manoeuvre.`
              : `This is a ${priorityLabels[selectedEvent.priority].toLowerCase()} public screening candidate. An analyst should verify current tracking before any operational decision.`}</strong>
          </section>

          {selectedMlAlert && <ManeuverStudyPanel key={selectedEvent.id} event={selectedEvent} protectedRecord={selectedProtectedRecord} counterpartRecord={selectedCounterpartRecord} now={triageMinute} onCandidateChange={setSelectedManeuverCandidate} />}

          <section className="ops-risk-metrics">
            <div><span>TCA in IST</span><strong>{formatIst(selectedEvent.tca, { seconds: true, year: true })}</strong><small>{countdown(selectedEvent.tca, simulationTime)} from simulation time</small></div>
            <div><span>Miss range</span><strong>{metric(selectedEvent.rangeKm, 'km', 3)}</strong><small>SOCRATES reported</small></div>
            <div><span>Relative speed</span><strong>{metric(selectedEvent.relativeSpeedKmS, 'km/s', 3)}</strong><small>At TCA</small></div>
            <div><span>CelesTrak Max Pc</span><strong>{formatProbability(selectedEvent.maximumProbability)}</strong><small>Conservative screening metric</small></div>
          </section>

          <section className="ops-model-state">
            <div className="ops-section-label"><span>CURRENT MODEL</span><b className={selectedMlAlert ? 'ready' : 'waiting'}>{selectedMlAlert ? 'HUMAN REVIEW' : 'NOT ELEVATED'}</b></div>
            {selectedMlAlert ? <div className="ops-public-model-metrics">
              <span><small>Model score</small><strong>{selectedMlAlert.score.toFixed(3)}</strong></span>
              <span><small>Threshold</small><strong>{selectedMlAlert.threshold.toFixed(2)}</strong></span>
              <span><small>Time to TCA</small><strong>{selectedMlAlert.hoursToTca.toFixed(1)} h</strong></span>
              <span><small>Input coverage</small><strong>{Math.round(selectedMlAlert.inputCoverage * 100)}%</strong></span>
            </div> : null}
            <p>{selectedMlAlert
              ? `The ${PUBLIC_TRIAGE_MODEL.trees.length}-tree model ranks this event from TCA, source Max Pc, miss distance and relative speed. The score is a review priority, not collision probability.`
              : 'This event did not cross the deployed two-day model threshold, or its TCA is outside the current 48-hour inference window.'}</p>
          </section>

          {!selectedMlAlert && <section className="ops-action-plan">
            <div className="ops-section-label"><span>NEXT REVIEW</span><b>HUMAN DECISION</b></div>
            <ol>{explanation.recommendedSteps.slice(0, 2).map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}</ol>
          </section>}

          <p className="ops-safety-note"><ShieldCheck size={13} /> OrbitShield proposes advisory study candidates. It never commands or executes a manoeuvre, and mission authority retains every decision.</p>
        </> : selectedRecord && selectedSatelliteId ? <div className="ops-object-profile">
          <section className="ops-object-identity">
            <span><Satellite size={14} /> {monitoredIdSet.has(selectedSatelliteId) ? 'MONITORED SATELLITE' : 'ACTIVE CATALOGUE SATELLITE'}</span>
            <strong>{cleanName(selectedRecord.OBJECT_NAME)}</strong>
            <small>NORAD {selectedSatelliteId} · {selectedRecord.OBJECT_ID || 'International designator unavailable'}</small>
          </section>
          <p className="ops-object-summary">{selectedFleetSatellite
            ? `${selectedFleetSatellite.name} is part of the active monitoring fleet. Mission focus: ${selectedFleetSatellite.mission}.`
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
          <button className={`ops-monitor-toggle ${monitoredIdSet.has(selectedSatelliteId) ? 'remove' : ''}`} onClick={() => monitoredIdSet.has(selectedSatelliteId) ? removeMonitoredSatellite(selectedSatelliteId) : addMonitoredSatellite(selectedSatelliteId)}>{monitoredIdSet.has(selectedSatelliteId) ? <X size={14} /> : <Plus size={14} />}<span><strong>{monitoredIdSet.has(selectedSatelliteId) ? 'Remove from monitoring' : 'Add to monitoring'}</strong><small>Saved on this judging device</small></span></button>
        </div> : <div className="ops-no-alert ops-monitoring-overview"><Radar size={25} /><strong>The review-priority model is active</strong><p>It rescans the loaded two-day screening feed and elevates conjunctions that need analyst attention.</p><div><span><b>{monitoredIds.length}</b> monitored satellites</span><span><b>{screeningCandidateCount}</b> screening candidates</span><span><b>{mlAlertCount}</b> model review alerts</span></div></div>}
      </aside>
    </section>
  </main>;
}
