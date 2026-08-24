'use client';

import dynamic from 'next/dynamic';
import {
  AlertTriangle, Check, ChevronDown, Crosshair, Database, Eye, EyeOff, Layers3,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, Pause, Play, Plus, RotateCcw,
  Search, Satellite, ShieldCheck, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import cdmFixture from './data/esa-validation-event.json';
import EncounterScene from './encounter-scene';
import { explainConjunction } from './lib/explanations';
import { INDIA_EO_FLEET } from './lib/fleet';
import { relativeRtnFromOmm } from './lib/orbit';
import { comparePriority, formatProbability } from './lib/screening';
import type { CatalogResponse, CdmSequence, ConjunctionRecord, ConjunctionResponse, DataStatus, OmmRecord, ScreeningPriority } from './lib/types';

const OrbitGlobe = dynamic(() => import('./orbit-globe'), {
  ssr: false,
  loading: () => <div className="globe-loading static">Loading WebGL workspace…</div>,
});

type ViewMode = 'screening' | 'validation';
type SortMode = 'priority' | 'tca' | 'probability' | 'range';

const validation = cdmFixture as CdmSequence;
const defaultWatchlist = INDIA_EO_FLEET.objects.map((item) => item.catalogId);
const priorityLabels: Record<ScreeningPriority, string> = { review: 'Review', watch: 'Watch', low: 'Low', 'needs-data': 'Needs data' };

function dataLabel(status?: DataStatus) {
  if (status === 'current') return 'Current';
  if (status === 'cached') return 'Cached';
  return 'Unavailable';
}

function dateUtc(value: string | null) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
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

function PublicRtnInset({ primary, secondary, time }: { primary?: OmmRecord; secondary?: OmmRecord; time: number }) {
  const relative = useMemo(() => primary && secondary ? relativeRtnFromOmm(primary, secondary, new Date(time)) : null, [primary, secondary, time]);
  if (!relative) return <div className="rtn-unavailable"><AlertTriangle size={14} /> Encounter geometry unavailable for one or both objects.</div>;
  const maximum = Math.max(1, Math.abs(relative.r), Math.abs(relative.t));
  const x = 50 + (relative.t / maximum) * 31;
  const y = 50 - (relative.r / maximum) * 31;
  return (
    <div className="public-rtn">
      <div className="public-rtn-head"><span>Magnified R–T–N inset</span><b>Approximate OMM geometry</b></div>
      <div className="public-rtn-grid"><span className="rtn-r">R</span><span className="rtn-t">T</span><i className="rtn-primary" /><i className="rtn-secondary" style={{ left: `${x}%`, top: `${y}%` }} /></div>
      <div className="rtn-values">R {relative.r.toFixed(0)} m · T {relative.t.toFixed(0)} m · N {relative.n.toFixed(0)} m</div>
      <p>SGP4 positions from current public orbit elements; SOCRATES remains authoritative for the reported closest-approach metrics.</p>
    </div>
  );
}

function SourceStatus({ status, title, detail }: { status?: DataStatus; title: string; detail: string }) {
  return <div className="source-status"><i className={statusTone(status)} /><span><strong>{title}</strong><small>{detail}</small></span></div>;
}

export default function OrbitScene() {
  const [mode, setMode] = useState<ViewMode>('screening');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [conjunctions, setConjunctions] = useState<ConjunctionResponse | null>(null);
  const [extraRecords, setExtraRecords] = useState<OmmRecord[]>([]);
  const [fleetActive, setFleetActive] = useState(false);
  const [watchlist, setWatchlist] = useState<number[]>(defaultWatchlist);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [focusCatalogId, setFocusCatalogId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [filters, setFilters] = useState<Set<ScreeningPriority>>(new Set(['review', 'watch', 'low', 'needs-data']));
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [simulationTime, setSimulationTime] = useState(0);
  const [clock, setClock] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [catalogueVisible, setCatalogueVisible] = useState(true);
  const lastTick = useRef(0);
  const watchlistReady = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      lastTick.current = now;
      setClock(now);
      setSimulationTime(now);
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

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/catalog?group=active').then((response) => response.json() as Promise<CatalogResponse>),
      fetch('/api/conjunctions?fleet=india-eo').then((response) => response.json() as Promise<ConjunctionResponse>),
    ]).then(([catalogResponse, conjunctionResponse]) => {
      if (!active) return;
      setCatalog(catalogResponse);
      setConjunctions(conjunctionResponse);
    }).catch(() => {
      if (!active) return;
      setCatalog({ status: 'unavailable', source: 'Catalogue unavailable', sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), count: 0, objects: [] });
      setConjunctions(null);
    });
    return () => { active = false; };
  }, []);

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
    extraRecords.forEach((record) => map.set(Number(record.NORAD_CAT_ID), record));
    return map;
  }, [catalog, extraRecords]);

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
    const ids = new Set([...watchlist, ...selectedIds, ...(previewId ? [previewId] : [])]);
    return [...ids].flatMap((id) => recordMap.get(id) ?? []);
  }, [previewId, recordMap, selectedIds, watchlist]);

  const explanation = selectedEvent ? explainConjunction(selectedEvent) : null;
  const selectedPrimary = selectedEvent ? recordMap.get(selectedEvent.primaryCatalogId) : undefined;
  const selectedSecondary = selectedEvent ? recordMap.get(selectedEvent.secondaryCatalogId) : undefined;
  const baseline = validation.visibleCdms.at(-1)!;

  async function selectEvent(event: ConjunctionRecord) {
    setSelectedEventId(event.id);
    setInspectorOpen(true);
    setFocusCatalogId(event.primaryCatalogId);
    try {
      const ids = [event.primaryCatalogId, event.secondaryCatalogId];
      const response = await fetch(`/api/catalog?catnr=${ids.join(',')}`).then((result) => result.json() as Promise<CatalogResponse>);
      if (response.objects.length) setExtraRecords((current) => {
        const merged = new Map(current.map((record) => [Number(record.NORAD_CAT_ID), record]));
        response.objects.forEach((record) => merged.set(Number(record.NORAD_CAT_ID), record));
        return [...merged.values()];
      });
    } catch { /* preserve event details; geometry may remain unavailable */ }
  }

  function activateFleet() {
    setFleetActive(true);
    setMode('screening');
    const highest = [...(conjunctions?.events ?? [])].sort(comparePriority)[0];
    if (highest) void selectEvent(highest);
    setFocusCatalogId(INDIA_EO_FLEET.objects[0].catalogId);
  }

  function preview(record: OmmRecord) {
    const id = Number(record.NORAD_CAT_ID);
    setPreviewId(id);
    setFocusCatalogId(id);
    setSearchOpen(false);
  }

  function toggleFilter(priority: ScreeningPriority) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority); else next.add(priority);
      return next;
    });
  }

  const sliderTca = selectedEvent ? new Date(selectedEvent.tca).getTime() : clock + 90 * 60_000;
  const sliderMin = selectedEvent ? Math.min(clock - 60 * 60_000, sliderTca - 12 * 60 * 60_000) : clock - 90 * 60_000;
  const sliderMax = Math.max(clock + 90 * 60_000, sliderTca + 60 * 60_000);

  return (
    <main className={`app-shell ${leftOpen ? '' : 'left-collapsed'} ${inspectorOpen ? '' : 'right-collapsed'}`}>
      <header className="command-bar">
        <button className="rail-toggle" onClick={() => setLeftOpen((value) => !value)} aria-label="Toggle fleet rail">{leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
        <div className="brand"><span className="brand-glyph"><i /></span><div><strong>ORBITSHIELD AI</strong><small>Orbital traffic intelligence</small></div></div>
        <nav className="view-tabs" aria-label="Intelligence view">
          <button className={mode === 'screening' ? 'active' : ''} onClick={() => setMode('screening')} aria-pressed={mode === 'screening'}>Current screening</button>
          <button className={mode === 'validation' ? 'active' : ''} onClick={() => { setMode('validation'); setInspectorOpen(true); }} aria-pressed={mode === 'validation'}>CDM validation</button>
        </nav>
        <div className="global-search">
          <Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="Search object or NORAD ID" aria-label="Search the active catalogue" />
          {query && <button onClick={() => { setQuery(''); setPreviewId(null); }} aria-label="Clear search"><X size={14} /></button>}
          {searchOpen && searchResults.length > 0 && <div className="search-results">{searchResults.map((record) => {
            const id = Number(record.NORAD_CAT_ID);
            return <button key={id} onClick={() => preview(record)}><span><strong>{record.OBJECT_NAME}</strong><small>NORAD {id} · epoch {dateUtc(record.EPOCH)}</small></span><Crosshair size={14} /></button>;
          })}</div>}
        </div>
        <div className={`top-status ${statusTone(catalog?.status)}`}><i /><span>{dataLabel(catalog?.status)} data</span></div>
      </header>

      <section className="workspace">
        {leftOpen && <aside className="left-rail">
          {mode === 'screening' ? <>
            <div className="rail-title"><span>Fleet & screening</span><b>{conjunctions?.events.length ?? '—'} events</b></div>
            <button className={`fleet-action ${fleetActive ? 'active' : ''}`} onClick={activateFleet}><span className="fleet-icon"><Satellite size={18} /></span><span><strong>India Earth Observation Fleet</strong><small>{fleetActive ? 'Active · highest priority selected' : 'Activate six verified missions'}</small></span>{fleetActive ? <Check size={16} /> : <Plus size={16} />}</button>
            <div className="watchlist-header"><span>Local watchlist · {watchlist.length}</span><button onClick={() => setWatchlist(defaultWatchlist)}><RotateCcw size={12} /> Reset</button></div>
            {previewId && <div className="preview-card"><span>Search preview</span><strong>{recordMap.get(previewId)?.OBJECT_NAME ?? `NORAD ${previewId}`}</strong><button onClick={() => setWatchlist((current) => current.includes(previewId) ? current : [...current, previewId])} disabled={watchlist.includes(previewId)}>{watchlist.includes(previewId) ? <><Check size={12} /> In watchlist</> : <><Plus size={12} /> Add to watchlist</>}</button></div>}
            <div className="queue-tools"><div className="filter-row">{(['review', 'watch', 'low'] as ScreeningPriority[]).map((priority) => <button key={priority} className={`${priority} ${filters.has(priority) ? 'active' : ''}`} onClick={() => toggleFilter(priority)} aria-pressed={filters.has(priority)}>{priorityLabels[priority]}</button>)}</div><label>Sort <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="priority">Priority</option><option value="tca">TCA</option><option value="probability">Max probability</option><option value="range">Minimum range</option></select><ChevronDown size={12} /></label></div>
            {!fleetActive ? <div className="rail-empty"><Layers3 size={22} /><strong>Global context is active</strong><p>Activate the India fleet to filter the current SOCRATES run and open the highest screening priority.</p></div> : <div className="event-queue">{sortedEvents.slice(0, 60).map((event) => <button key={event.id} className={`event-row ${selectedEventId === event.id ? 'selected' : ''}`} onClick={() => void selectEvent(event)}><span className={`priority-dot ${event.priority}`} /><span className="event-names"><strong>{cleanName(event.primaryName)}</strong><small>{cleanName(event.secondaryName)}</small></span><span className="event-figures"><b>{event.rangeKm?.toFixed(2) ?? '—'} km</b><small>{event.maximumProbability?.toExponential(1) ?? 'Needs data'}</small></span></button>)}</div>}
            <div className="rail-sources"><SourceStatus status={catalog?.status} title="Orbit catalogue" detail={`${catalog?.count.toLocaleString() ?? '—'} active payload records`} /><SourceStatus status={conjunctions?.status} title="SOCRATES screening" detail={`${conjunctions?.run.conjunctionCount?.toLocaleString() ?? '—'} conjunctions in run`} /></div>
          </> : <>
            <div className="rail-title"><span>CDM validation</span><b>ESA event {validation.eventId}</b></div>
            <div className="validation-card selected"><div><Database size={15} /><span>Held-out event fixture</span></div><strong>Collision Avoidance Challenge</strong><p>{validation.visibleCdms.length} messages visible through T−2 · {validation.fullCdmCount} messages recorded</p></div>
            <div className="validation-note"><ShieldCheck size={17} /><div><strong>Leakage-safe review</strong><p>Event {validation.eventId} is reserved from future Phase 2 training. Post-cutoff data remains hidden until reveal.</p></div></div>
            <div className="history-list"><div className="history-heading"><span>Observed through cutoff</span><small>log₁₀ risk</small></div>{validation.visibleCdms.map((point, index) => <div className="history-row" key={`${point.time_to_tca}-${index}`}><span>T−{point.time_to_tca.toFixed(2)}d</span><i style={{ width: `${Math.max(5, ((point.risk ?? -8) + 8) / 6 * 100)}%` }} /><b>{point.risk?.toFixed(3) ?? '—'}</b></div>)}</div>
            <div className="rail-sources"><SourceStatus status="cached" title="Official ESA archive" detail="Small deterministic fixture · archive not committed" /></div>
          </>}
        </aside>}

        <section className="visual-workspace">
          {mode === 'screening' ? <OrbitGlobe catalogue={catalog?.objects ?? []} focusRecords={focusRecords} fleetIds={watchlist} selectedIds={selectedIds} previewId={previewId} focusCatalogId={focusCatalogId} simulationTime={simulationTime} showCatalogue={catalogueVisible} onObjectSelect={(id) => setFocusCatalogId(id)} /> : <EncounterScene point={revealed ? validation.recordedOutcome : baseline} />}
          <div className="scene-topline"><div><span>{mode === 'screening' ? 'Global orbital context' : `ESA held-out event ${validation.eventId}`}</span><strong>{mode === 'screening' ? `${catalog?.count.toLocaleString() ?? '—'} SGP4-propagated active payloads` : 'R–T–N encounter frame · absolute Earth position unavailable'}</strong></div>{mode === 'screening' && <button onClick={() => setCatalogueVisible((value) => !value)}>{catalogueVisible ? <Eye size={14} /> : <EyeOff size={14} />}{catalogueVisible ? 'Catalogue visible' : 'Catalogue hidden'}</button>}</div>
          {mode === 'screening' && !fleetActive && <button className="floating-fleet-action" onClick={activateFleet}><Satellite size={18} /><span><strong>Focus India Earth Observation Fleet</strong><small>Open the current screening queue</small></span></button>}
          {mode === 'screening' && selectedEvent && <div className="floating-rtn"><PublicRtnInset primary={selectedPrimary} secondary={selectedSecondary} time={simulationTime} /></div>}
          {mode === 'validation' && <div className="validation-overlay"><span>{revealed ? 'Recorded final message' : 'Visible evidence at T−2 cutoff'}</span><strong>log₁₀ risk {revealed ? validation.recordedOutcome.risk?.toFixed(4) : baseline.risk?.toFixed(4)}</strong><small>Miss distance {metric(revealed ? validation.recordedOutcome.miss_distance : baseline.miss_distance, 'm', 0)}</small></div>}
        </section>

        {inspectorOpen && <aside className="event-inspector"><button className="inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><PanelRightClose size={16} /></button>
          {mode === 'screening' ? selectedEvent && explanation ? <>
            <div className="inspector-kicker"><span>Event inspector</span><span className={`priority-pill ${selectedEvent.priority}`}>{priorityLabels[selectedEvent.priority]}</span></div><h1>{cleanName(selectedEvent.primaryName)}</h1><div className="pair-line"><span>NORAD {selectedEvent.primaryCatalogId}</span><i /><span>NORAD {selectedEvent.secondaryCatalogId}</span></div><h2>{cleanName(selectedEvent.secondaryName)}</h2>
            <div className="tca-block"><span>Time of closest approach</span><strong>{dateUtc(selectedEvent.tca)}</strong><b>{countdown(selectedEvent.tca, clock)}</b></div>
            <div className="metric-grid"><div><span>Minimum range</span><strong>{metric(selectedEvent.rangeKm, 'km')}</strong></div><div><span>Relative speed</span><strong>{metric(selectedEvent.relativeSpeedKmS, 'km/s')}</strong></div><div><span>Maximum probability</span><strong>{formatProbability(selectedEvent.maximumProbability)}</strong></div><div><span>Dilution threshold</span><strong>{metric(selectedEvent.dilutionKm, 'km')}</strong></div></div>
            <section className="reason-panel"><h3>Why it is prioritized</h3>{selectedEvent.reasons.map((reason) => <p key={reason}><i />{reason}</p>)}</section>
            <section className="explanation-panel"><div className="section-head"><span>Structured explanation</span><b>Deterministic</b></div><h3>What is happening</h3><p>{explanation.whatIsHappening}</p><h3>Recommended workflow steps</h3><ol>{explanation.recommendedSteps.map((step) => <li key={step}>{step}</li>)}</ol><h3>What this does not mean</h3><p>{explanation.limitation}</p></section>
            <details><summary>Raw SOCRATES values <ChevronDown size={13} /></summary><dl><dt>Primary element age</dt><dd>{metric(selectedEvent.primaryElementAgeDays, 'days')}</dd><dt>Secondary element age</dt><dd>{metric(selectedEvent.secondaryElementAgeDays, 'days')}</dd><dt>Event ID</dt><dd>{selectedEvent.id}</dd></dl></details>
            <details><summary>Source provenance & limits <ChevronDown size={13} /></summary><p>Screening metrics are from {conjunctions?.source}. Source update: {dateUtc(conjunctions?.sourceUpdatedAt ?? null)}. Public OMM propagation is contextual and may not reproduce the SOCRATES TCA exactly.</p></details>
          </> : <div className="inspector-empty"><Crosshair size={25} /><h2>Select a screened event</h2><p>Activate the India fleet, then choose an event to inspect verified metrics, provenance and next steps.</p></div> : <>
            <div className="inspector-kicker"><span>Validation inspector</span><span className="priority-pill validation">Held out</span></div><h1>ESA event {validation.eventId}</h1><p className="validation-lede">An authentic message sequence from ESA’s Collision Avoidance Challenge, truncated at the T−2 decision cutoff.</p>
            <div className="metric-grid validation-metrics"><div><span>Visible CDMs</span><strong>{validation.visibleCdms.length}</strong></div><div><span>Cutoff</span><strong>T−{validation.cutoffDays} days</strong></div><div><span>Latest-known baseline</span><strong>{baseline.risk?.toFixed(5)}</strong></div><div><span>Relative speed</span><strong>{metric(baseline.relative_speed ? baseline.relative_speed / 1000 : null, 'km/s')}</strong></div></div>
            <section className="model-slot"><span>Phase 2 model integration</span><strong>No forecast inserted</strong><p>Persistence and gradient-boosting baselines, followed by PI-RNet, will be trained and tested event-wise. This slot intentionally contains no representative prediction.</p></section>
            <section className="outcome-panel"><div className="section-head"><span>Recorded final outcome</span><b>{revealed ? 'Revealed' : 'Hidden'}</b></div>{revealed ? <><strong>log₁₀ risk {validation.recordedOutcome.risk?.toFixed(5)}</strong><p>Recorded at T−{validation.recordedOutcome.time_to_tca.toFixed(2)} days with {metric(validation.recordedOutcome.miss_distance, 'm', 0)} miss distance.</p></> : <p>Messages after T−2 are withheld so a future model can be judged against evidence it could not see.</p>}<button onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={14} /> : <Eye size={14} />}{revealed ? 'Hide outcome' : 'Reveal recorded outcome'}</button></section>
            <details open><summary>Validation safeguards <ChevronDown size={13} /></summary><ul><li>Event {validation.eventId} is reserved from Phase 2 training.</li><li>Only CDMs at or before T−2 are visible by default.</li><li>No absolute historical Earth position is inferred.</li></ul></details><details><summary>Source provenance <ChevronDown size={13} /></summary><p>Official ESA Kelvins Collision Avoidance Challenge training archive. Prepared {dateUtc(validation.preparedAt)}. The full archive is not committed; only this deterministic event fixture and metadata are bundled.</p></details>
          </>}
        </aside>}
        {!inspectorOpen && <button className="open-inspector" onClick={() => setInspectorOpen(true)}><PanelRightClose size={15} /> Open inspector</button>}
      </section>

      <footer className="timeline-bar">{mode === 'screening' ? <>
        <div className="time-controls"><button onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause simulation' : 'Play simulation'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Simulation speed"><option value={1}>1×</option><option value={10}>10×</option><option value={60}>60×</option></select></div>
        <div className="timeline-track"><span>{dateUtc(new Date(simulationTime).toISOString())}</span><input type="range" min={sliderMin} max={sliderMax} value={Math.min(sliderMax, Math.max(sliderMin, simulationTime))} onChange={(event) => { setSimulationTime(Number(event.target.value)); setPlaying(false); }} /><small>{selectedEvent ? countdown(selectedEvent.tca, simulationTime) : 'Global live time'}</small></div>
        <div className="timeline-actions"><button onClick={() => { setSimulationTime(Date.now()); setPlaying(true); setSpeed(1); }}>Live time</button><button className="primary" onClick={() => selectedEvent && setSimulationTime(new Date(selectedEvent.tca).getTime())} disabled={!selectedEvent}><Crosshair size={13} /> Jump to TCA</button></div>
      </> : <div className="validation-timeline"><span>ESA event {validation.eventId}</span><i /><strong>T−{validation.visibleCdms[0].time_to_tca.toFixed(2)}d</strong><div className="cutoff-marker">Decision cutoff · T−2d</div><i className="hidden-tail" /><span>Recorded outcome hidden by default</span></div>}</footer>
    </main>
  );
}
