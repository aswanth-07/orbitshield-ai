'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Crosshair, Database, Eye, EyeOff, Layers3,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, Pause, Play, Plus, RotateCcw,
  RefreshCw, Search, Satellite, ShieldCheck, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import cdmFixture from './data/esa-validation-event.json';
import replayFixture from './data/esa-validation-replay.json';
import EncounterScene from './encounter-scene';
import {
  animateTcaReplay,
  countDebrisBySize,
  DEBRIS_COLORS,
  isSatelliteObjectType,
  objectMarkerColor,
  TCA_REPLAY_DURATION_MS,
  tcaReplayStart,
  type TcaReplayPhase,
} from './lib/collision-visualization';
import { explainConjunction } from './lib/explanations';
import { INDIA_EO_FLEET } from './lib/fleet';
import { relativeRtnFromOmm } from './lib/orbit';
import { comparePriority, formatProbability } from './lib/screening';
import { formatIst } from './lib/time';
import type { OrbitCameraMode } from './orbit-globe';
import type {
  CatalogResponse, CdmSequence, ConjunctionRecord, ConjunctionResponse, DataStatus,
  DebrisSize, OmmRecord, SatelliteMedia, ScreeningPriority, T2ModelReplay, ThreatObject, ThreatResponse,
} from './lib/types';
import ModelReplayPanel, { RiskHistoryCard } from './model-replay';
import PublicReviewCard from './public-review-card';

const OrbitGlobe = dynamic(() => import('./orbit-globe'), {
  ssr: false,
  loading: () => <div className="globe-loading static">Loading WebGL workspace…</div>,
});
const EncounterDepthInset = dynamic(() => import('./encounter-depth-inset'), {
  ssr: false,
  loading: () => <div className="rtn-unavailable">Loading 3D encounter geometry…</div>,
});

type ViewMode = 'screening' | 'validation';
type SortMode = 'priority' | 'tca' | 'probability' | 'range';
type DemoStage = 'overview' | 'public-review' | 'tca-follow' | 'ai-replay';

const validation = cdmFixture as CdmSequence;
const modelReplay = replayFixture as T2ModelReplay;
const defaultWatchlist = INDIA_EO_FLEET.objects.map((item) => item.catalogId);
const priorityLabels: Record<ScreeningPriority, string> = { review: 'Review', watch: 'Watch', low: 'Low', 'needs-data': 'Needs data' };
const debrisColors = DEBRIS_COLORS;
const debrisLabels: Record<DebrisSize, string> = { small: 'Small <0.1 m²', medium: 'Medium 0.1–1 m²', large: 'Large >1 m²', unknown: 'Size unknown' };

function dataLabel(status?: DataStatus) {
  if (status === 'current') return 'Current';
  if (status === 'cached') return 'Cached';
  return 'Unavailable';
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

function metric(value: number | null, unit = '', digits = 3) {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function cleanName(value: string) {
  return value.replace(/\s*\[[+?−-]\]\s*$/, '').trim();
}

function statusTone(status?: DataStatus) {
  return status === 'current' ? 'current' : status === 'cached' ? 'cached' : 'unavailable';
}

function PublicDepthInset({ primary, secondary, time, primaryColor, secondaryColor, reportedRangeKm }: { primary?: OmmRecord; secondary?: OmmRecord; time: number; primaryColor: string; secondaryColor: string; reportedRangeKm?: number | null }) {
  const relative = useMemo(() => primary && secondary ? relativeRtnFromOmm(primary, secondary, new Date(time)) : null, [primary, secondary, time]);
  if (!relative) return <div className="rtn-unavailable"><AlertTriangle size={14} /> Encounter geometry unavailable for one or both objects.</div>;
  const propagatedRangeM = Math.hypot(relative.r, relative.t, relative.n);
  if (reportedRangeKm && propagatedRangeM > Math.max(100_000, reportedRangeKm * 1_000 * 50)) {
    return <div className="rtn-unavailable"><AlertTriangle size={14} /> Current public elements do not reproduce this archived SOCRATES encounter closely enough for a trustworthy R–T–N reconstruction. OrbitShield hides the conflicting geometry.</div>;
  }
  return (
    <div className="public-rtn">
      <div className="public-rtn-head"><span>Oblique 3D R–T–N encounter</span><b>Depth-aware OMM geometry</b></div>
      <EncounterDepthInset r={relative.r} t={relative.t} n={relative.n} primaryColor={primaryColor} secondaryColor={secondaryColor} />
      <div className="rtn-values">R {relative.r.toFixed(0)} m · T {relative.t.toFixed(0)} m · N {relative.n.toFixed(0)} m</div>
      <p>The N axis is independently magnified so out-of-plane depth remains visible; exact R, T and N values are printed below. Geometry uses public elements, while SOCRATES remains authoritative.</p>
    </div>
  );
}

function EncounterSchematic({ event, counterpartKind }: { event: ConjunctionRecord; counterpartKind: string }) {
  return <div className="encounter-schematic" role="img" aria-label={`Magnified schematic of ${cleanName(event.primaryName)} and ${cleanName(event.secondaryName)} at closest approach`}>
    <div className="schematic-stage"><div className="protected-object"><Satellite size={20} /><span>Protected satellite</span></div><i className="separation-line"><b>{metric(event.rangeKm, 'km')}</b></i><div className="debris-object"><i /><span>{counterpartKind}</span></div></div>
    <p>Screened objects remain nearly coincident at Earth scale. This magnified local view shows the pair clearly; the reported SOCRATES miss range is authoritative.</p>
  </div>;
}

function SourceStatus({ status, title, detail }: { status?: DataStatus; title: string; detail: string }) {
  return <div className="source-status"><i className={statusTone(status)} /><span><strong>{title}</strong><small>{detail}</small></span></div>;
}

function CollisionCandidateList({
  catalogId,
  risks,
  threatsById,
  selectedEventId,
  clock,
  onSelectEvent,
}: {
  catalogId: number;
  risks: ConjunctionRecord[];
  threatsById: Map<number, ThreatObject>;
  selectedEventId: string | null;
  clock: number;
  onSelectEvent: (event: ConjunctionRecord) => void;
}) {
  if (!risks.length) {
    return <div className="risk-empty"><ShieldCheck size={20} /><strong>No fleet-screening match</strong><p>This object has no event in the current India EO SOCRATES view. That is not a guarantee of zero collision risk.</p></div>;
  }
  return <div className="satellite-risk-list">{risks.map((event) => {
    const otherId = event.primaryCatalogId === catalogId ? event.secondaryCatalogId : event.primaryCatalogId;
    const otherName = cleanName(event.primaryCatalogId === catalogId ? event.secondaryName : event.primaryName);
    const counterpart = threatsById.get(otherId);
    const satellite = defaultWatchlist.includes(otherId) || isSatelliteObjectType(counterpart?.objectType);
    const typeLabel = satellite
      ? 'Satellite'
      : `${counterpart?.objectType === 'R/B' ? 'Rocket body' : 'Debris'} · ${debrisLabels[counterpart?.size ?? 'unknown']}`;
    const color = objectMarkerColor(satellite ? 'PAY' : counterpart?.objectType, counterpart?.size);
    return <button
      key={event.id}
      className={selectedEventId === event.id ? 'selected' : ''}
      onClick={() => onSelectEvent(event)}
      aria-label={`Inspect collision candidate with ${otherName}`}
      aria-pressed={selectedEventId === event.id}
    >
      <i style={{ background: color }} />
      <span><strong>{otherName}</strong><small>{typeLabel} · NORAD {otherId}</small><em className={`candidate-priority ${event.priority}`}>{priorityLabels[event.priority]}</em></span>
      <span className="risk-values"><b>{event.rangeKm?.toFixed(2) ?? 'N/A'} km</b><small>{formatProbability(event.maximumProbability)}</small><em>{countdown(event.tca, clock)}</em></span>
    </button>;
  })}</div>;
}

function CollisionDetails({
  event,
  source,
  sourceUpdatedAt,
  clock,
  tcaAnimating,
}: {
  event: ConjunctionRecord;
  source?: string;
  sourceUpdatedAt: string | null;
  clock: number;
  tcaAnimating: boolean;
}) {
  const explanation = explainConjunction(event);
  return <section className="collision-review-detail" aria-live="polite">
    <div className="collision-pair-heading"><span>Selected encounter</span><strong>{cleanName(event.primaryName)} <b>vs</b> {cleanName(event.secondaryName)}</strong></div>
    <div className="tca-block"><span>Time of closest approach in IST</span><strong>{formatIst(event.tca, { seconds: true, year: true })}</strong><b>{tcaAnimating ? 'Moving to TCA…' : countdown(event.tca, clock)}</b></div>
    <div className="metric-grid"><div><span>Minimum range</span><strong>{metric(event.rangeKm, 'km')}</strong></div><div><span>Relative speed</span><strong>{metric(event.relativeSpeedKmS, 'km/s')}</strong></div><div><span>Maximum probability</span><strong>{formatProbability(event.maximumProbability)}</strong></div><div><span>Dilution threshold</span><strong>{metric(event.dilutionKm, 'km')}</strong></div></div>
    <section className="reason-panel"><h3>Why this candidate is prioritized</h3>{event.reasons.map((reason) => <p key={reason}><i />{reason}</p>)}</section>
    <section className="explanation-panel"><div className="section-head"><span>What the screening shows</span><b>Deterministic</b></div><p>{explanation.whatIsHappening}</p><h3>Recommended review steps</h3><ol>{explanation.recommendedSteps.map((step) => <li key={step}>{step}</li>)}</ol><h3>Important limit</h3><p>{explanation.limitation}</p></section>
    <details><summary>Raw SOCRATES values <ChevronDown size={13} /></summary><dl><dt>Primary element age</dt><dd>{metric(event.primaryElementAgeDays, 'days')}</dd><dt>Secondary element age</dt><dd>{metric(event.secondaryElementAgeDays, 'days')}</dd><dt>Event ID</dt><dd>{event.id}</dd></dl></details>
    <details><summary>Source provenance & limits <ChevronDown size={13} /></summary><p>Screening metrics are from {source}. Source update: {formatIst(sourceUpdatedAt, { seconds: true })}. The globe uses current public OMM propagation for context and may not reproduce the reported encounter geometry exactly.</p></details>
  </section>;
}

function SatelliteProfile({
  catalogId,
  name,
  record,
  threat,
  risks,
  threatsById,
  selectedEvent,
  media,
  mediaLoading,
  clock,
  tcaAnimating,
  source,
  sourceUpdatedAt,
  collisionOverview,
  onSelectEvent,
  onClearEvent,
}: {
  catalogId: number;
  name: string;
  record?: OmmRecord;
  threat?: ThreatObject;
  risks: ConjunctionRecord[];
  threatsById: Map<number, ThreatObject>;
  selectedEvent: ConjunctionRecord | null;
  media: SatelliteMedia | null;
  mediaLoading: boolean;
  clock: number;
  tcaAnimating: boolean;
  source?: string;
  sourceUpdatedAt: string | null;
  collisionOverview?: ReactNode;
  onSelectEvent: (event: ConjunctionRecord) => void;
  onClearEvent: () => void;
}) {
  const satelliteObject = !threat || isSatelliteObjectType(threat.objectType);
  const impactedSatellites = !satelliteObject && threat ? [...risks.reduce((map, event) => {
    const otherId = event.primaryCatalogId === catalogId ? event.secondaryCatalogId : event.primaryCatalogId;
    const otherName = cleanName(event.primaryCatalogId === catalogId ? event.secondaryName : event.primaryName);
    const current = map.get(otherId);
    if (!current || (event.maximumProbability ?? -1) > (current.event.maximumProbability ?? -1)) {
      map.set(otherId, { catalogId: otherId, name: otherName, event });
    }
    return map;
  }, new Map<number, { catalogId: number; name: string; event: ConjunctionRecord }>()).values()] : [];
  const priority = selectedEvent?.priority ?? (risks.some((event) => event.priority === 'review') ? 'review' : risks.length ? 'watch' : 'low');

  return <>
    {selectedEvent ? <button className="collision-back" onClick={onClearEvent}><ArrowLeft size={13} /> Back to satellite</button> : null}
    <div className="inspector-kicker"><span>{selectedEvent ? 'Collision review' : satelliteObject ? 'Satellite profile' : threat?.objectType === 'R/B' ? 'Rocket body risk object' : 'Debris risk object'}</span><span className={`priority-pill ${priority}`}>{selectedEvent ? priorityLabels[selectedEvent.priority] : satelliteObject ? `${risks.length} candidate${risks.length === 1 ? '' : 's'}` : `${impactedSatellites.length} satellite${impactedSatellites.length === 1 ? '' : 's'} at risk`}</span></div>
    <h1>{name}</h1>
    <div className="pair-line"><span>NORAD {catalogId}</span><i /><span>{threat?.objectType ?? record?.OBJECT_TYPE ?? 'Active payload'}</span></div>
    {collisionOverview}

    {!selectedEvent ? <>
      <div className="satellite-media">
        {mediaLoading ? <div className="media-placeholder"><span className="media-spinner" />Searching verified public media…</div> : media?.status === 'available' && media.imageUrl ? <>
          <Image src={media.imageUrl} alt={media.description || `${name} satellite`} fill sizes="(max-width: 1100px) 330px, 350px" unoptimized />
          <div className="media-caption"><strong>{media.title}</strong><span>{media.license}{media.author ? ` · ${media.author}` : ''}</span>{media.pageUrl ? <a href={media.pageUrl} target="_blank" rel="noreferrer">Open source ↗</a> : null}</div>
        </> : <div className="media-placeholder"><Satellite size={28} /><strong>No verified public image found</strong><span>The orbital record is still available; no mission image is fabricated.</span></div>}
      </div>
      <div className="metric-grid satellite-metrics">
        <div><span>Orbit epoch</span><strong>{formatIst(record?.EPOCH ?? null, { seconds: true })}</strong></div>
        <div><span>Owner / country</span><strong>{threat?.owner || record?.COUNTRY_CODE || 'Not provided'}</strong></div>
        <div><span>Object class</span><strong>{threat?.objectType ?? record?.OBJECT_TYPE ?? 'Payload'}</strong></div>
        <div><span>Radar cross section</span><strong>{threat?.rcs === null || threat?.rcs === undefined ? 'Not published' : `${threat.rcs.toFixed(4)} m²`}</strong></div>
      </div>
      {!satelliteObject && threat ? <div className="selected-size"><i style={{ background: debrisColors[threat.size] }} /><span>{debrisLabels[threat.size]}</span><b>{threat.eventCount} screening event{threat.eventCount === 1 ? '' : 's'}</b></div> : null}
    </> : null}

    <section className={`risk-panel ${selectedEvent ? 'has-selection' : ''}`}>
      <div className="section-head"><span>{satelliteObject ? 'Collision candidates' : 'Satellites under collision risk'}</span><b>{risks.length ? `${risks.length} live` : 'No match'}</b></div>
      {!satelliteObject && impactedSatellites.length ? <div className="affected-satellites">{impactedSatellites.map((satellite) => <button key={satellite.catalogId} onClick={() => onSelectEvent(satellite.event)}><Satellite size={13} /><span><strong>{satellite.name}</strong><small>NORAD {satellite.catalogId}</small></span><b>{formatProbability(satellite.event.maximumProbability)}</b></button>)}</div> : null}
      {!satelliteObject && risks.length ? <div className="collision-detail-label">Choose a satellite or one screening event</div> : null}
      <CollisionCandidateList catalogId={catalogId} risks={risks} threatsById={threatsById} selectedEventId={selectedEvent?.id ?? null} clock={clock} onSelectEvent={onSelectEvent} />
    </section>

    {selectedEvent ? <CollisionDetails event={selectedEvent} source={source} sourceUpdatedAt={sourceUpdatedAt} clock={clock} tcaAnimating={tcaAnimating} /> : <details><summary>Data provenance & limits <ChevronDown size={13} /></summary><p>Orbit position uses public CelesTrak GP elements. Risk metrics use the current public SOCRATES screening run. RCS is a radar cross-section band, not a guaranteed physical dimension.</p></details>}
  </>;
}

export default function OrbitScene() {
  const [stage, setStage] = useState<DemoStage>('overview');
  const [mode, setMode] = useState<ViewMode>('screening');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [conjunctions, setConjunctions] = useState<ConjunctionResponse | null>(null);
  const [threats, setThreats] = useState<ThreatResponse | null>(null);
  const [extraRecords, setExtraRecords] = useState<OmmRecord[]>([]);
  const [fleetActive, setFleetActive] = useState(false);
  const [watchlist, setWatchlist] = useState<number[]>(defaultWatchlist);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<number | null>(null);
  const [satelliteMedia, setSatelliteMedia] = useState<SatelliteMedia | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [focusCatalogId, setFocusCatalogId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<OrbitCameraMode>('global');
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [filters, setFilters] = useState<Set<ScreeningPriority>>(new Set(['review', 'watch', 'low', 'needs-data']));
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [simulationTime, setSimulationTime] = useState(0);
  const [clock, setClock] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [modelRun, setModelRun] = useState(false);
  const [catalogueVisible, setCatalogueVisible] = useState(true);
  const [dataRefreshing, setDataRefreshing] = useState(false);
  const [lastLiveRefresh, setLastLiveRefresh] = useState(0);
  const [tcaAnimating, setTcaAnimating] = useState(false);
  const [replayPhase, setReplayPhase] = useState<TcaReplayPhase | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(0);
  const lastTick = useRef(0);
  const watchlistReady = useRef(false);
  const simulationTimeRef = useRef(0);
  const tcaAnimationCancelRef = useRef<(() => void) | null>(null);
  const selectionSequenceRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      lastTick.current = now;
      setClock(now);
      setSimulationTime(now);
      simulationTimeRef.current = now;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem('orbitshield.watchlist.v1');
        watchlistReady.current = true;
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) setWatchlist(parsed.filter((value): value is number => Number.isInteger(value)));
        }
      } catch {
        watchlistReady.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!watchlistReady.current) return;
    try {
      localStorage.setItem('orbitshield.watchlist.v1', JSON.stringify(watchlist));
    } catch {
      // Keep the watchlist usable when browser storage is blocked or full.
    }
  }, [watchlist]);

  const refreshScreeningData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setDataRefreshing(true);
    try {
      const response = await fetch('/api/live').then((result) => result.json() as Promise<{ conjunctions: ConjunctionResponse; threats: ThreatResponse; refreshedAt: string }>);
      setConjunctions(response.conjunctions);
      setThreats(response.threats);
      setLastLiveRefresh(Date.now());
    } catch {
      // Preserve the last usable live or cached response during a transient refresh failure.
    } finally {
      if (showSpinner) setDataRefreshing(false);
    }
  }, []);

  useEffect(() => {
    simulationTimeRef.current = simulationTime;
  }, [simulationTime]);

  useEffect(() => {
    let active = true;
    fetch('/api/catalog?group=active').then((response) => response.json() as Promise<CatalogResponse>).then((catalogResponse) => {
      if (active) setCatalog(catalogResponse);
    }).catch(() => {
      if (active) setCatalog({ status: 'unavailable', source: 'Catalogue unavailable', sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), count: 0, objects: [] });
    });
    fetch('/api/bootstrap').then((response) => response.json() as Promise<{ conjunctions: ConjunctionResponse; threats: ThreatResponse; refreshedAt: string }>).then((snapshot) => {
      if (!active) return;
      setConjunctions(snapshot.conjunctions);
      setThreats(snapshot.threats);
      setLastLiveRefresh(new Date(snapshot.refreshedAt).getTime());
    }).catch(() => {
      // The live request below remains the authoritative fallback.
    }).finally(() => {
      if (active) void refreshScreeningData(false);
    });
    const refreshTimer = window.setInterval(() => void refreshScreeningData(false), 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [refreshScreeningData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (playing) setSimulationTime((current) => current + (now - lastTick.current) * speed);
      lastTick.current = now;
    }, 500);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const recordMap = useMemo(() => {
    const map = new Map<number, OmmRecord>();
    catalog?.objects.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    threats?.objects.forEach((threat) => {
      if (threat.record) map.set(threat.catalogId, threat.record);
    });
    extraRecords.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    return map;
  }, [catalog, extraRecords, threats]);

  const threatsById = useMemo(() => new Map((threats?.objects ?? []).map((threat) => [threat.catalogId, threat])), [threats]);

  const sortedEvents = useMemo(() => {
    const events = [...(conjunctions?.events ?? [])].filter((event) => filters.has(event.priority));
    events.sort((a, b) => {
      if (sortMode === 'tca') return new Date(a.tca).getTime() - new Date(b.tca).getTime();
      if (sortMode === 'probability') return (b.maximumProbability ?? -1) - (a.maximumProbability ?? -1);
      if (sortMode === 'range') return (a.rangeKm ?? Number.POSITIVE_INFINITY) - (b.rangeKm ?? Number.POSITIVE_INFINITY);
      return comparePriority(a, b);
    });
    return events;
  }, [conjunctions, filters, sortMode]);

  const selectedEvent = useMemo(() => conjunctions?.events.find((event) => event.id === selectedEventId) ?? null, [conjunctions, selectedEventId]);
  const selectedThreat = selectedSatelliteId ? threatsById.get(selectedSatelliteId) : undefined;
  const selectedSatellite = selectedSatelliteId ? recordMap.get(selectedSatelliteId) : undefined;
  const selectedSatelliteName = selectedSatellite?.OBJECT_NAME ?? selectedThreat?.name ?? null;
  const selectedSatelliteRisks = useMemo(() => {
    if (!selectedSatelliteId) return [];
    return [...(conjunctions?.events ?? [])]
      .filter((event) => event.primaryCatalogId === selectedSatelliteId || event.secondaryCatalogId === selectedSatelliteId)
      .sort(comparePriority);
  }, [conjunctions, selectedSatelliteId]);
  const searchResults = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    if (normalized.length < 2 || !catalog) return [];
    return catalog.objects.filter((record) => String(record.NORAD_CAT_ID) === normalized || record.OBJECT_NAME.toUpperCase().includes(normalized)).sort((a, b) => {
      const aExact = a.OBJECT_NAME.toUpperCase() === normalized || String(a.NORAD_CAT_ID) === normalized ? -1 : 0;
      const bExact = b.OBJECT_NAME.toUpperCase() === normalized || String(b.NORAD_CAT_ID) === normalized ? -1 : 0;
      return aExact - bExact || a.OBJECT_NAME.localeCompare(b.OBJECT_NAME);
    }).slice(0, 8);
  }, [catalog, query]);

  const selectedIds = useMemo(
    () => selectedEvent ? [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId] : [],
    [selectedEvent],
  );
  const focusRecords = useMemo(() => {
    const ids = new Set([...watchlist, ...selectedIds, ...(previewId ? [previewId] : []), ...(selectedSatelliteId ? [selectedSatelliteId] : [])]);
    return [...ids].flatMap((id) => recordMap.get(id) ?? []);
  }, [previewId, recordMap, selectedIds, selectedSatelliteId, watchlist]);

  const debrisCounts = useMemo(() => {
    return countDebrisBySize(threats?.objects ?? []);
  }, [threats]);
  const debrisTotal = debrisCounts.small + debrisCounts.medium + debrisCounts.large + debrisCounts.unknown;

  const selectedPrimary = selectedEvent ? recordMap.get(selectedEvent.primaryCatalogId) : undefined;
  const selectedSecondary = selectedEvent ? recordMap.get(selectedEvent.secondaryCatalogId) : undefined;
  const selectedCounterpartId = selectedEvent && selectedSatelliteId
    ? selectedEvent.primaryCatalogId === selectedSatelliteId ? selectedEvent.secondaryCatalogId : selectedEvent.primaryCatalogId
    : null;
  const selectedCounterpartThreat = selectedCounterpartId ? threatsById.get(selectedCounterpartId) : undefined;
  const selectedCounterpartKind = selectedCounterpartThreat && !isSatelliteObjectType(selectedCounterpartThreat.objectType)
    ? `${selectedCounterpartThreat.objectType === 'R/B' ? 'rocket body' : 'debris'} · ${debrisLabels[selectedCounterpartThreat.size]}`
    : 'tracked satellite';
  const baseline = validation.visibleCdms.at(-1)!;

  useEffect(() => {
    if (!selectedSatelliteId || !selectedSatelliteName) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ catnr: String(selectedSatelliteId), name: selectedSatelliteName });
    fetch(`/api/object-image?${params}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<SatelliteMedia>)
      .then((media) => setSatelliteMedia(media))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSatelliteMedia({ status: 'unavailable', source: 'Wikimedia Commons', message: 'Media search failed.' });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setMediaLoading(false);
      });
    return () => controller.abort();
  }, [selectedSatelliteId, selectedSatelliteName]);

  const cancelTcaTransition = useCallback(() => {
    tcaAnimationCancelRef.current?.();
    tcaAnimationCancelRef.current = null;
    setTcaAnimating(false);
    setReplayPhase(null);
    setReplaySpeed(0);
  }, []);

  const runTcaTransition = useCallback((tca: string) => {
    cancelTcaTransition();
    setPlaying(false);
    const target = new Date(tca).getTime();
    if (!Number.isFinite(target)) return;
    const from = tcaReplayStart(simulationTimeRef.current, target);
    simulationTimeRef.current = from;
    setSimulationTime(from);
    setStage('tca-follow');
    setCameraMode('follow');
    setReplayPhase('follow');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      simulationTimeRef.current = target;
      setSimulationTime(target);
      setReplayPhase('encounter');
      setCameraMode('encounter');
      setStage('public-review');
      return;
    }
    setTcaAnimating(true);
    tcaAnimationCancelRef.current = animateTcaReplay({
      from,
      tca: target,
      duration: TCA_REPLAY_DURATION_MS,
      scheduler: {
        now: () => performance.now(),
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (id) => window.cancelAnimationFrame(id),
      },
      onUpdate: (frame) => {
        simulationTimeRef.current = frame.simulationTime;
        setSimulationTime(frame.simulationTime);
        setReplayPhase(frame.phase);
        setReplaySpeed(frame.displayedSpeed);
        if (frame.phase === 'acquire') setCameraMode('pair-follow');
        if (frame.phase === 'encounter') setCameraMode('encounter');
      },
      onComplete: () => {
        tcaAnimationCancelRef.current = null;
        setTcaAnimating(false);
        setReplayPhase('encounter');
        setReplaySpeed(0);
        setCameraMode('encounter');
        setStage('public-review');
      },
    });
  }, [cancelTcaTransition]);

  useEffect(() => () => {
    tcaAnimationCancelRef.current?.();
  }, []);

  async function selectEvent(event: ConjunctionRecord) {
    const selectionSequence = ++selectionSequenceRef.current;
    cancelTcaTransition();
    setLeftOpen(false);
    setSelectedEventId(event.id);
    setInspectorOpen(true);
    setCatalogueVisible(false);
    setPlaying(false);
    setStage('public-review');
    const currentSelectionBelongsToPair = selectedSatelliteId === event.primaryCatalogId || selectedSatelliteId === event.secondaryCatalogId;
    const currentThreat = selectedSatelliteId ? threatsById.get(selectedSatelliteId) : undefined;
    const currentSelectionIsSatellite = currentSelectionBelongsToPair && selectedSatelliteId !== null && (!currentThreat || isSatelliteObjectType(currentThreat.objectType));
    const protectedCatalogId = currentSelectionIsSatellite && selectedSatelliteId
      ? selectedSatelliteId
      : watchlist.includes(event.primaryCatalogId)
        ? event.primaryCatalogId
        : watchlist.includes(event.secondaryCatalogId)
          ? event.secondaryCatalogId
          : event.primaryCatalogId;
    setSelectedSatelliteId(protectedCatalogId);
    setFocusCatalogId(protectedCatalogId);
    setCameraMode('pair-follow');
    setCameraResetKey((value) => value + 1);
    try {
      const ids = [event.primaryCatalogId, event.secondaryCatalogId];
      if (ids.some((id) => !recordMap.has(id))) {
        const response = await fetch(`/api/catalog?catnr=${ids.join(',')}`).then((result) => result.json() as Promise<CatalogResponse>);
        if (response.objects.length) setExtraRecords((current) => {
          const merged = new Map(current.map((record) => [Number(record.NORAD_CAT_ID), record]));
          response.objects.forEach((record) => merged.set(Number(record.NORAD_CAT_ID), record));
          return [...merged.values()];
        });
      }
    } catch { /* preserve event details; geometry may remain unavailable */ }
    if (selectionSequence === selectionSequenceRef.current) setCameraResetKey((value) => value + 1);
  }

  function selectSatellite(catalogId: number) {
    selectionSequenceRef.current += 1;
    cancelTcaTransition();
    setLeftOpen(false);
    if (catalogId !== selectedSatelliteId) {
      setSatelliteMedia(null);
      setMediaLoading(true);
    }
    setSelectedSatelliteId(catalogId);
    setSelectedEventId(null);
    setCatalogueVisible(false);
    setPreviewId(catalogId);
    setFocusCatalogId(catalogId);
    setCameraMode('follow');
    setCameraResetKey((value) => value + 1);
    setInspectorOpen(true);
    setMode('screening');
    setStage('public-review');
  }

  function clearSelectedEvent() {
    selectionSequenceRef.current += 1;
    cancelTcaTransition();
    setSelectedEventId(null);
    setCatalogueVisible(false);
    if (selectedSatelliteId) {
      setFocusCatalogId(selectedSatelliteId);
      setCameraMode('follow');
      setCameraResetKey((value) => value + 1);
    }
  }

  function returnToLive() {
    selectionSequenceRef.current += 1;
    cancelTcaTransition();
    const now = Date.now();
    simulationTimeRef.current = now;
    setSimulationTime(now);
    setPlaying(true);
    setSpeed(1);
    setReplayPhase(null);
    setReplaySpeed(0);
  }

  function activateFleet() {
    setFleetActive(true);
    setMode('screening');
    setStage('public-review');
    const ranked = [...(conjunctions?.events ?? [])].sort(comparePriority);
    const featuredDebrisEvent = ranked.find((event) => {
      const counterpartId = defaultWatchlist.includes(event.primaryCatalogId) ? event.secondaryCatalogId : event.primaryCatalogId;
      const counterpart = threatsById.get(counterpartId);
      return Boolean(counterpart && !isSatelliteObjectType(counterpart.objectType));
    });
    const featured = featuredDebrisEvent ?? ranked[0];
    if (featured) void selectEvent(featured);
    else {
      setFocusCatalogId(INDIA_EO_FLEET.objects[0].catalogId);
      setCameraMode('follow');
      setCameraResetKey((value) => value + 1);
    }
  }

  function openAiReplay() {
    cancelTcaTransition();
    setMode('validation');
    setStage('ai-replay');
    setLeftOpen(false);
    setInspectorOpen(true);
    setCatalogueVisible(false);
    setModelRun(false);
    setRevealed(false);
  }

  function returnToPublicReview() {
    setMode('screening');
    setStage(selectedEvent ? 'public-review' : 'overview');
    setInspectorOpen(Boolean(selectedEvent));
    setCameraMode(selectedEvent ? 'encounter' : 'global');
    setCameraResetKey((value) => value + 1);
  }

  function preview(record: OmmRecord) {
    const id = Number(record.NORAD_CAT_ID);
    selectSatellite(id);
    setSearchOpen(false);
  }

  function toggleFilter(priority: ScreeningPriority) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority); else next.add(priority);
      return next;
    });
  }

  function chooseCameraMode(mode: OrbitCameraMode) {
    setCameraMode(mode);
    if (mode === 'global') setCatalogueVisible(true);
    setCameraResetKey((value) => value + 1);
  }

  const sliderTca = selectedEvent ? new Date(selectedEvent.tca).getTime() : clock + 90 * 60_000;
  const sliderMin = selectedEvent ? Math.min(clock - 60 * 60_000, sliderTca - 12 * 60 * 60_000) : clock - 90 * 60_000;
  const sliderMax = Math.max(clock + 90 * 60_000, sliderTca + 60 * 60_000);
  const landing = stage === 'overview' && mode === 'screening' && !fleetActive && !selectedSatelliteId;

  return (
    <main className={`app-shell ${landing ? 'landing' : ''} ${leftOpen ? '' : 'left-collapsed'} ${inspectorOpen ? '' : 'right-collapsed'}`}>
      <header className="command-bar">
        {!landing && <button className="rail-toggle" onClick={() => setLeftOpen((value) => !value)} aria-label="Toggle fleet rail">{leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>}
        <div className="brand"><span className="brand-glyph"><i /></span><div><strong>ORBITSHIELD</strong><small>AI-assisted conjunction triage</small></div></div>
        {landing ? <div className="command-intro">From orbital alert overload to one explainable review.</div> : <nav className="demo-progress" aria-label="Demo progress">
          <button className={mode === 'screening' ? 'active' : ''} onClick={returnToPublicReview} aria-pressed={mode === 'screening'}><span>01</span> Public review</button>
          <i />
          <button className={stage === 'tca-follow' ? 'active' : ''} onClick={() => selectedEvent && runTcaTransition(selectedEvent.tca)} disabled={!selectedEvent || tcaAnimating} aria-pressed={stage === 'tca-follow'}><span>02</span> Follow to TCA</button>
          <i />
          <button className={mode === 'validation' ? 'active' : ''} onClick={openAiReplay} aria-pressed={mode === 'validation'}><span>03</span> AI replay</button>
        </nav>}
        {!landing && leftOpen && mode === 'screening' && !selectedEvent && <div className="global-search">
          <Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="Search object or NORAD ID" aria-label="Search the active catalogue" />
          {query && <button onClick={() => { setQuery(''); setPreviewId(null); }} aria-label="Clear search"><X size={14} /></button>}
          {searchOpen && searchResults.length > 0 && <div className="search-results">{searchResults.map((record) => {
            const id = Number(record.NORAD_CAT_ID);
            return <button key={id} onClick={() => preview(record)}><span><strong>{record.OBJECT_NAME}</strong><small>NORAD {id} · epoch {formatIst(record.EPOCH, { seconds: true })}</small></span><Crosshair size={14} /></button>;
          })}</div>}
        </div>}
        <div className={`top-status ${statusTone(catalog?.status)}`}><i /><span>{dataLabel(catalog?.status)} data</span></div>
      </header>

      <section className="workspace">
        {leftOpen && <aside className="left-rail">
          {mode === 'screening' ? <>
            <div className="rail-title"><span>Fleet & screening</span><b>{conjunctions?.events.length ?? 'N/A'} events</b></div>
            <button className={`fleet-action ${fleetActive ? 'active' : ''}`} onClick={activateFleet}><span className="fleet-icon"><Satellite size={18} /></span><span><strong>India Earth Observation Fleet</strong><small>{fleetActive ? 'Active · debris encounter selected' : 'Activate six verified missions'}</small></span>{fleetActive ? <Check size={16} /> : <Plus size={16} />}</button>
            <div className="watchlist-header"><span>Local watchlist · {watchlist.length}</span><button onClick={() => setWatchlist(defaultWatchlist)}><RotateCcw size={12} /> Reset</button></div>
            {previewId && <div className="preview-card"><span>Search preview</span><strong>{recordMap.get(previewId)?.OBJECT_NAME ?? `NORAD ${previewId}`}</strong><button onClick={() => setWatchlist((current) => current.includes(previewId) ? current : [...current, previewId])} disabled={watchlist.includes(previewId)}>{watchlist.includes(previewId) ? <><Check size={12} /> In watchlist</> : <><Plus size={12} /> Add to watchlist</>}</button></div>}
            <div className="queue-tools"><div className="filter-row">{(['review', 'watch', 'low'] as ScreeningPriority[]).map((priority) => <button key={priority} className={`${priority} ${filters.has(priority) ? 'active' : ''}`} onClick={() => toggleFilter(priority)} aria-pressed={filters.has(priority)}>{priorityLabels[priority]}</button>)}</div><label>Sort <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="priority">Priority</option><option value="tca">TCA</option><option value="probability">Max probability</option><option value="range">Minimum range</option></select><ChevronDown size={12} /></label></div>
            {!fleetActive ? <div className="rail-empty"><Layers3 size={22} /><strong>Global context is active</strong><p>Activate the India fleet to open the highest-ranked debris encounter in the current screening run.</p></div> : <div className="event-queue">{sortedEvents.slice(0, 5).map((event) => <button key={event.id} className={`event-row ${selectedEventId === event.id ? 'selected' : ''}`} onClick={() => void selectEvent(event)}><span className={`priority-dot ${event.priority}`} /><span className="event-names"><strong>{cleanName(event.primaryName)}</strong><small>{cleanName(event.secondaryName)}</small></span><span className="event-figures"><b>{event.rangeKm?.toFixed(2) ?? 'N/A'} km</b><small>{event.maximumProbability?.toExponential(1) ?? 'Needs data'}</small></span></button>)}</div>}
            <div className="rail-sources"><SourceStatus status={catalog?.status} title="Orbit catalogue" detail={`${catalog?.count.toLocaleString() ?? 'N/A'} active payload records`} /><SourceStatus status={conjunctions?.status} title="SOCRATES screening" detail={`${conjunctions?.run.conjunctionCount?.toLocaleString() ?? 'N/A'} conjunctions in run`} /><SourceStatus status={threats?.status} title="Risk-object overlay" detail={`${threats?.positionedCount ?? 'N/A'} positioned · ${threats?.count ?? 'N/A'} screened`} /></div>
          </> : <>
            <div className="rail-title"><span>CDM validation</span><b>ESA event {validation.eventId}</b></div>
            <div className="validation-card selected"><div><Database size={15} /><span>Held-out event fixture</span></div><strong>Collision Avoidance Challenge</strong><p>{validation.visibleCdms.length} messages visible through T−2 · {validation.fullCdmCount} messages recorded</p></div>
            <div className="validation-note"><ShieldCheck size={17} /><div><strong>Leakage-safe review</strong><p>Event {validation.eventId} was excluded from model training. Post-cutoff data remains hidden until reveal.</p></div></div>
            <div className="history-list"><div className="history-heading"><span>Observed through cutoff</span><small>log₁₀ risk</small></div>{validation.visibleCdms.map((point, index) => <div className="history-row" key={`${point.time_to_tca}-${index}`}><span>T−{point.time_to_tca.toFixed(2)}d</span><i style={{ width: `${Math.max(5, ((point.risk ?? -8) + 8) / 6 * 100)}%` }} /><b>{point.risk?.toFixed(3) ?? 'N/A'}</b></div>)}</div>
            <div className="rail-sources"><SourceStatus status="cached" title="Official ESA archive" detail="Small deterministic fixture · archive not committed" /></div>
          </>}
        </aside>}

        <section className="visual-workspace">
          {mode === 'screening' ? <OrbitGlobe catalogue={catalog?.objects ?? []} focusRecords={focusRecords} threats={threats?.objects ?? []} fleetIds={watchlist} selectedEvent={selectedEvent} selectedSatelliteId={selectedSatelliteId} cameraMode={cameraMode} cameraResetKey={cameraResetKey} previewId={previewId} focusCatalogId={focusCatalogId} simulationTime={simulationTime} showCatalogue={catalogueVisible} replayPhase={replayPhase} replayActive={tcaAnimating} onObjectSelect={selectSatellite} /> : <><EncounterScene point={revealed ? validation.recordedOutcome : baseline} /><RiskHistoryCard sequence={validation} replay={modelReplay} /></>}
          {mode === 'screening' && <div className={`scene-topline ${selectedSatelliteId ? 'focused' : ''}`}><div><span>{selectedEvent ? 'Focused collision review · unrelated risk markers hidden' : selectedSatelliteName ? 'Satellite follow view · unrelated markers hidden' : 'Live public screening'}</span><strong>{selectedEvent ? `${cleanName(selectedEvent.primaryName)} ↔ ${cleanName(selectedEvent.secondaryName)}` : selectedSatelliteName ? `${selectedSatelliteName} · use Follow or Free 3D camera` : `${conjunctions?.run.conjunctionCount?.toLocaleString() ?? 'N/A'} close approaches screened`}</strong>{selectedEvent ? <small className="focus-feed-line">Solid green = selected satellite · dashed color = counterpart · white = closest approach</small> : selectedSatelliteName ? <small className="focus-feed-line">Follow locks the moving object · Free 3D keeps the current scene but unlocks pan and orbit</small> : <small className={`live-feed-line ${statusTone(threats?.status)}`} aria-live="polite"><i />{dataLabel(threats?.status)} feed · refreshed {lastLiveRefresh ? formatIst(lastLiveRefresh, { seconds: true }) : 'loading'}</small>}</div>{!landing && !selectedSatelliteId && <div className="scene-actions"><button className={`refresh-button ${dataRefreshing ? 'refreshing' : ''}`} onClick={() => void refreshScreeningData(true)} disabled={dataRefreshing}><RefreshCw size={14} />{dataRefreshing ? 'Refreshing…' : 'Refresh live data'}</button><button onClick={() => setCatalogueVisible((value) => !value)}>{catalogueVisible ? <Eye size={14} /> : <EyeOff size={14} />}{catalogueVisible ? 'Catalogue visible' : 'Catalogue hidden'}</button></div>}</div>}
          {mode === 'screening' && selectedEvent && replayPhase === 'encounter' && <div className="tca-encounter-overlay"><div className="encounter-overlay-title"><span>MAGNIFIED ENCOUNTER · NOT TO EARTH SCALE</span><strong>{cleanName(selectedEvent.primaryName)} ↔ {cleanName(selectedEvent.secondaryName)}</strong></div><EncounterSchematic event={selectedEvent} counterpartKind={selectedCounterpartKind} /></div>}
          {mode === 'screening' && selectedSatelliteId && <div className="camera-toolbar" role="toolbar" aria-label="3D camera controls"><div className="camera-toolbar-label"><strong>3D camera</strong><small>{cameraMode === 'free' ? 'Drag to orbit · right-drag or Shift-drag to pan · wheel/pinch to zoom' : cameraMode === 'follow' ? 'Tracking the selected satellite while you orbit around it' : cameraMode === 'encounter' ? 'Centered on the closest-approach geometry; switch to Free 3D to translate anywhere' : 'Earth overview'}</small></div><div className="camera-toolbar-actions"><button className={cameraMode === 'follow' ? 'active' : ''} onClick={() => chooseCameraMode('follow')} disabled={!selectedSatelliteId}><Satellite size={14} /> Follow</button><button className={cameraMode === 'encounter' ? 'active' : ''} onClick={() => chooseCameraMode('encounter')} disabled={!selectedEvent}><Crosshair size={14} /> Encounter</button><button className={cameraMode === 'free' ? 'active' : ''} onClick={() => chooseCameraMode('free')}><Eye size={14} /> Free 3D</button><button onClick={() => chooseCameraMode('global')}><RotateCcw size={14} /> Reset</button>{selectedSatelliteId ? <button onClick={() => setCatalogueVisible((value) => !value)}>{catalogueVisible ? <EyeOff size={14} /> : <Eye size={14} />}{catalogueVisible ? 'Hide context' : 'Show context'}</button> : null}</div></div>}
          {mode === 'screening' && !landing && !selectedSatelliteId && <div className="debris-legend"><div><span>Debris size · radar cross section</span><b>{debrisTotal} objects</b></div><span className="satellite-key"><i /><strong>All satellites</strong><b>bright green</b></span>{(['small', 'medium', 'large', 'unknown'] as DebrisSize[]).map((size) => <span key={size}><i style={{ background: debrisColors[size] }} /><strong>{debrisLabels[size]}</strong><b>{debrisCounts[size]}</b></span>)}</div>}
          {landing && <button className="landing-cta" onClick={activateFleet}><span className="landing-cta-kicker">INDIA EARTH OBSERVATION FLEET</span><strong>Find the debris encounter that needs attention.</strong><p>OrbitShield narrows public orbital traffic to one explainable review, then follows the protected satellite and debris to their closest approach.</p><span className="landing-cta-action">Analyse six verified missions <ArrowRight size={17} /></span></button>}
          {mode === 'validation' && <div className="validation-overlay"><span>{revealed ? 'Recorded final message' : modelRun ? 'OrbitShield triage complete' : 'Visible evidence at T−2 cutoff'}</span><strong>{revealed ? `Final Pc ${modelReplay.recordedOutcome.finalProbability.toExponential(3)}` : modelRun ? `AI triage ${modelReplay.inference.triage.toUpperCase()}` : `log₁₀ risk ${baseline.risk?.toFixed(4)}`}</strong><small>{revealed ? `${modelReplay.recordedOutcome.probabilityRatioToBaseline.toFixed(2)}× the persistence estimate` : modelRun ? modelReplay.calibration.displayWarning : `Miss distance ${metric(baseline.miss_distance, 'm', 0)}`}</small></div>}
        </section>

        {inspectorOpen && <aside className={`event-inspector ${mode === 'validation' ? 'model-inspector' : ''}`}><button className="inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><PanelRightClose size={16} /></button>
          {mode === 'screening' ? selectedEvent ? <PublicReviewCard
            event={selectedEvent}
            tcaLabel={tcaAnimating ? 'REPLAYING' : countdown(selectedEvent.tca, simulationTime)}
            tcaTime={formatIst(selectedEvent.tca, { seconds: true, year: true })}
            counterpartKind={selectedCounterpartKind}
            replayActive={tcaAnimating}
            replayPhase={replayPhase}
            replaySpeed={replaySpeed}
            followAvailable={Boolean(selectedPrimary && selectedSecondary)}
            onFollow={() => runTcaTransition(selectedEvent.tca)}
            onAiReplay={openAiReplay}
            technicalEvidence={<><PublicDepthInset primary={selectedPrimary} secondary={selectedSecondary} time={simulationTime} primaryColor={objectMarkerColor(selectedPrimary?.OBJECT_TYPE)} secondaryColor={objectMarkerColor(selectedCounterpartThreat?.objectType ?? selectedSecondary?.OBJECT_TYPE, selectedCounterpartThreat?.size)} reportedRangeKm={selectedEvent.rangeKm} /><section className="technical-source"><strong>Safe review workflow</strong><ol><li>Request newer tracking or operator CDM data.</li><li>Escalate to a flight-dynamics analyst.</li><li>Reassess after the next source update.</li></ol><p>Visual path uses public elements; reported SOCRATES metrics remain authoritative. Source updated {formatIst(conjunctions?.sourceUpdatedAt ?? null, { seconds: true })}.</p></section></>}
          /> : selectedSatelliteId && selectedSatelliteName ? <SatelliteProfile catalogId={selectedSatelliteId} name={selectedSatelliteName} record={selectedSatellite} threat={selectedThreat} risks={selectedSatelliteRisks} threatsById={threatsById} selectedEvent={null} media={satelliteMedia} mediaLoading={mediaLoading} clock={clock} tcaAnimating={false} source={conjunctions?.source} sourceUpdatedAt={conjunctions?.sourceUpdatedAt ?? null} onSelectEvent={(event) => void selectEvent(event)} onClearEvent={clearSelectedEvent} /> : <div className="inspector-empty"><Crosshair size={25} /><h2>Select any satellite</h2><p>Click a satellite or open the India fleet to begin one focused review.</p></div> : <ModelReplayPanel sequence={validation} replay={modelReplay} modelRun={modelRun} revealed={revealed} onRun={() => setModelRun(true)} onReveal={() => setRevealed((value) => !value)} onBack={returnToPublicReview} />}
        </aside>}
        {!landing && !inspectorOpen && <button className="open-inspector" onClick={() => setInspectorOpen(true)}><PanelRightClose size={15} /> Open inspector</button>}
      </section>

      <footer className="timeline-bar">{mode === 'screening' ? <>
        <div className="time-controls"><button onClick={() => { cancelTcaTransition(); setPlaying((value) => !value); }} aria-label={playing ? 'Pause simulation' : 'Play simulation'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Simulation speed"><option value={1}>1×</option><option value={10}>10×</option><option value={60}>60×</option></select></div>
        <div className="timeline-track"><span>{formatIst(simulationTime, { seconds: true })}</span><input type="range" min={sliderMin} max={sliderMax} value={Math.min(sliderMax, Math.max(sliderMin, simulationTime))} onChange={(event) => { cancelTcaTransition(); const value = Number(event.target.value); simulationTimeRef.current = value; setSimulationTime(value); setPlaying(false); }} /><small>{selectedEvent ? tcaAnimating ? 'Animating to TCA' : countdown(selectedEvent.tca, simulationTime) : 'Global live time'}</small></div>
        <div className="timeline-actions"><button onClick={returnToLive}>Live time</button><button className="primary" onClick={() => selectedEvent && runTcaTransition(selectedEvent.tca)} disabled={!selectedEvent || tcaAnimating}><Crosshair size={13} />{tcaAnimating ? `${replayPhase ?? 'Following'}…` : 'Follow to TCA'}</button></div>
      </> : <div className="validation-timeline"><span>ESA event {validation.eventId}</span><i /><strong>{modelRun ? 'T−2 model complete' : `T−${validation.visibleCdms[0].time_to_tca.toFixed(2)}d`}</strong><div className="cutoff-marker">Decision cutoff · T−2d</div><i className="hidden-tail" /><span>{revealed ? 'Recorded outcome revealed after inference' : 'Recorded outcome hidden'}</span></div>}</footer>
    </main>
  );
}
