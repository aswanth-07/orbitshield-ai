'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Mode = 'monitor' | 'replay';
type ObjectKind = 'payload' | 'debris' | 'rocket';

type OrbitalObject = {
  id: number;
  name: string;
  kind: ObjectKind;
  altitude: number;
  inclination: number;
  raan: number;
  phase: number;
  angularSpeed: number;
};

type ConjunctionEvent = {
  id: string;
  primary: string;
  secondary: string;
  primaryIndex: number;
  secondaryIndex: number;
  tca: string;
  range: string;
  speed: string;
  probability: string;
  dilution: string;
  urgency: 'WATCH' | 'REVIEW' | 'LOW';
};

type ReplayEvent = {
  id: string;
  label: string;
  pattern: string;
  baseline: number;
  prediction: number;
  finalRisk: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  history: number[];
  features: { label: string; value: number; direction: 'up' | 'down' }[];
};

const conjunctions: ConjunctionEvent[] = [
  {
    id: 'DEMO-0821-A',
    primary: 'ORBITSHIELD-01',
    secondary: 'DEBRIS-2049',
    primaryIndex: 0,
    secondaryIndex: 1,
    tca: '21 Aug 2026 · 10:18:42 UTC',
    range: '0.82 km',
    speed: '12.41 km/s',
    probability: '3.4 × 10⁻⁴',
    dilution: '0.06 km',
    urgency: 'REVIEW',
  },
  {
    id: 'DEMO-0821-B',
    primary: 'CUBESAT-117',
    secondary: 'ROCKET BODY-76',
    primaryIndex: 92,
    secondaryIndex: 231,
    tca: '21 Aug 2026 · 12:06:15 UTC',
    range: '1.24 km',
    speed: '8.73 km/s',
    probability: '8.1 × 10⁻⁵',
    dilution: '0.11 km',
    urgency: 'WATCH',
  },
  {
    id: 'DEMO-0821-C',
    primary: 'EARTH-OBS-42',
    secondary: 'DEBRIS-3911',
    primaryIndex: 147,
    secondaryIndex: 388,
    tca: '22 Aug 2026 · 02:44:03 UTC',
    range: '2.68 km',
    speed: '6.29 km/s',
    probability: '1.7 × 10⁻⁶',
    dilution: '0.24 km',
    urgency: 'LOW',
  },
];

const replayEvents: ReplayEvent[] = [
  {
    id: 'ESA-DEMO-05612',
    label: 'Escalating event',
    pattern: 'Risk rises as covariance tightens',
    baseline: -5.12,
    prediction: -3.93,
    finalRisk: -3.74,
    priority: 'HIGH',
    history: [-6.1, -5.9, -5.5, -5.2, -4.7, -4.3, -3.93],
    features: [
      { label: 'Risk trend', value: 92, direction: 'up' },
      { label: 'Miss-distance trend', value: 76, direction: 'up' },
      { label: 'Covariance volume', value: 64, direction: 'down' },
      { label: 'Observation recency', value: 48, direction: 'up' },
      { label: 'Message count', value: 35, direction: 'up' },
    ],
  },
  {
    id: 'ESA-DEMO-10987',
    label: 'False alarm',
    pattern: 'Early alert falls after refinement',
    baseline: -3.61,
    prediction: -5.08,
    finalRisk: -5.31,
    priority: 'LOW',
    history: [-3.8, -3.7, -4.0, -4.2, -4.6, -4.9, -5.08],
    features: [
      { label: 'Covariance volume', value: 88, direction: 'down' },
      { label: 'Risk trend', value: 72, direction: 'down' },
      { label: 'Miss distance', value: 59, direction: 'down' },
      { label: 'Observation recency', value: 41, direction: 'up' },
      { label: 'Relative speed', value: 28, direction: 'up' },
    ],
  },
  {
    id: 'ESA-DEMO-02741',
    label: 'Persistently low risk',
    pattern: 'Stable geometry and uncertainty',
    baseline: -6.24,
    prediction: -6.08,
    finalRisk: -6.16,
    priority: 'LOW',
    history: [-6.4, -6.3, -6.2, -6.3, -6.1, -6.2, -6.08],
    features: [
      { label: 'Miss distance', value: 79, direction: 'down' },
      { label: 'Risk stability', value: 66, direction: 'down' },
      { label: 'Covariance volume', value: 52, direction: 'down' },
      { label: 'Message count', value: 32, direction: 'up' },
      { label: 'Relative speed', value: 21, direction: 'up' },
    ],
  },
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createObjects(): OrbitalObject[] {
  const random = seededRandom(20260821);
  const objects = Array.from({ length: 512 }, (_, id) => {
    const kindRoll = random();
    const kind: ObjectKind =
      kindRoll < 0.55 ? 'payload' : kindRoll < 0.91 ? 'debris' : 'rocket';
    const altitude = 330 + Math.pow(random(), 1.8) * 1700;
    return {
      id,
      name:
        kind === 'payload'
          ? `ACTIVE-${String(id + 1).padStart(4, '0')}`
          : kind === 'debris'
            ? `DEBRIS-${String(1800 + id).padStart(4, '0')}`
            : `ROCKET BODY-${String(id + 1).padStart(3, '0')}`,
      kind,
      altitude,
      inclination: (8 + random() * 104) * (Math.PI / 180),
      raan: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      angularSpeed: 0.025 + (1700 - Math.min(1700, altitude)) / 65000,
    };
  });

  objects[0] = {
    ...objects[0],
    name: 'ORBITSHIELD-01',
    kind: 'payload',
    altitude: 565,
    inclination: 0.91,
    raan: 0.42,
    phase: 0.25,
    angularSpeed: 0.043,
  };
  objects[1] = {
    ...objects[1],
    name: 'DEBRIS-2049',
    kind: 'debris',
    altitude: 574,
    inclination: 0.94,
    raan: 0.48,
    phase: 0.18,
    angularSpeed: 0.042,
  };
  return objects;
}

const orbitalObjects = createObjects();
const kindColors: Record<ObjectKind, string> = {
  payload: '#43e6c8',
  debris: '#ff996f',
  rocket: '#ffd46a',
};

function orbitalPosition(object: OrbitalObject, time: number) {
  const radius = 1 + object.altitude / 6371;
  const u = object.phase + time * object.angularSpeed;
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosO = Math.cos(object.raan);
  const sinO = Math.sin(object.raan);
  const cosI = Math.cos(object.inclination);
  const sinI = Math.sin(object.inclination);
  return {
    x: radius * (cosO * cosU - sinO * sinU * cosI),
    y: radius * (sinO * cosU + cosO * sinU * cosI),
    z: radius * sinU * sinI,
  };
}

function viewRotate(
  point: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
) {
  const x1 = point.x * Math.cos(yaw) - point.z * Math.sin(yaw);
  const z1 = point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
  const y2 = point.y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = point.y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return { x: x1, y: y2, z: z2 };
}

function shortProbability(logRisk: number) {
  return Math.pow(10, logRisk).toExponential(2);
}

export default function OrbitScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef({ yaw: -0.62, pitch: 0.28 });
  const zoomRef = useRef(1);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const timeRef = useRef(0);
  const [mode, setMode] = useState<Mode>('monitor');
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [selectedReplay, setSelectedReplay] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(10);
  const [timeline, setTimeline] = useState(0);
  const [fps, setFps] = useState(60);
  const [revealed, setRevealed] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<ObjectKind, boolean>>({
    payload: true,
    debris: true,
    rocket: true,
  });

  const currentEvent = conjunctions[selectedEvent];
  const currentReplay = replayEvents[selectedReplay];
  const filteredConjunctions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conjunctions;
    return conjunctions.filter((event) =>
      `${event.primary} ${event.secondary} ${event.id}`.toLowerCase().includes(needle),
    );
  }, [query]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let lastFrame = performance.now();
    let fpsStart = lastFrame;
    let fpsFrames = 0;
    let uiUpdate = lastFrame;
    const stars = Array.from({ length: 180 }, (_, index) => {
      const random = seededRandom(7000 + index);
      return { x: random(), y: random(), r: 0.25 + random() * 1.25, a: 0.2 + random() * 0.6 };
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const drawStars = (width: number, height: number, time: number) => {
      const glow = context.createRadialGradient(
        width * 0.52,
        height * 0.46,
        0,
        width * 0.52,
        height * 0.46,
        Math.max(width, height) * 0.78,
      );
      glow.addColorStop(0, '#0b2541');
      glow.addColorStop(0.48, '#071627');
      glow.addColorStop(1, '#020812');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
      for (const star of stars) {
        context.globalAlpha = star.a + Math.sin(time * 0.0008 + star.x * 30) * 0.08;
        context.fillStyle = '#b7d9ff';
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const drawEarth = (cx: number, cy: number, radius: number) => {
      context.save();
      context.shadowColor = 'rgba(66, 202, 255, 0.55)';
      context.shadowBlur = 34;
      const atmosphere = context.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.38,
        radius * 0.08,
        cx,
        cy,
        radius * 1.08,
      );
      atmosphere.addColorStop(0, '#2384a5');
      atmosphere.addColorStop(0.58, '#07506f');
      atmosphere.addColorStop(0.9, '#05253d');
      atmosphere.addColorStop(1, 'rgba(33,157,205,.12)');
      context.fillStyle = atmosphere;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.clip();

      const night = context.createLinearGradient(cx - radius, cy, cx + radius, cy);
      night.addColorStop(0, 'rgba(1,8,19,.72)');
      night.addColorStop(0.55, 'rgba(3,28,49,.08)');
      night.addColorStop(1, 'rgba(46,184,206,.18)');
      context.fillStyle = night;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      context.strokeStyle = 'rgba(105,224,225,.12)';
      context.lineWidth = 0.8;
      for (let i = -3; i <= 3; i += 1) {
        const latitude = (i / 4) * radius;
        context.beginPath();
        context.ellipse(cx, cy + latitude, radius * Math.cos((i * Math.PI) / 9), radius * 0.16, 0, 0, Math.PI * 2);
        context.stroke();
      }
      for (let i = -3; i <= 3; i += 1) {
        context.beginPath();
        context.ellipse(cx, cy, radius * (0.2 + Math.abs(i) * 0.06), radius, i * 0.2, 0, Math.PI * 2);
        context.stroke();
      }

      context.fillStyle = 'rgba(51,142,119,.48)';
      context.beginPath();
      context.moveTo(cx - radius * 0.56, cy - radius * 0.3);
      context.bezierCurveTo(cx - radius * 0.3, cy - radius * 0.55, cx - radius * 0.18, cy - radius * 0.24, cx - radius * 0.29, cy - radius * 0.06);
      context.bezierCurveTo(cx - radius * 0.1, cy + radius * 0.08, cx - radius * 0.28, cy + radius * 0.3, cx - radius * 0.38, cy + radius * 0.18);
      context.bezierCurveTo(cx - radius * 0.61, cy + radius * 0.07, cx - radius * 0.7, cy - radius * 0.12, cx - radius * 0.56, cy - radius * 0.3);
      context.fill();
      context.beginPath();
      context.moveTo(cx + radius * 0.05, cy - radius * 0.5);
      context.bezierCurveTo(cx + radius * 0.35, cy - radius * 0.58, cx + radius * 0.66, cy - radius * 0.34, cx + radius * 0.55, cy - radius * 0.08);
      context.bezierCurveTo(cx + radius * 0.46, cy + radius * 0.15, cx + radius * 0.17, cy + radius * 0.16, cx + radius * 0.11, cy - radius * 0.02);
      context.bezierCurveTo(cx - radius * 0.02, cy - radius * 0.18, cx - radius * 0.05, cy - radius * 0.38, cx + radius * 0.05, cy - radius * 0.5);
      context.fill();
      context.restore();

      context.strokeStyle = 'rgba(92,221,255,.42)';
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(cx, cy, radius + 1, 0, Math.PI * 2);
      context.stroke();
    };

    const projectPoint = (
      point: { x: number; y: number; z: number },
      cx: number,
      cy: number,
      scale: number,
    ) => {
      const view = viewRotate(point, rotationRef.current.yaw, rotationRef.current.pitch);
      return { x: cx + view.x * scale, y: cy - view.y * scale, z: view.z };
    };

    const drawTrail = (
      object: OrbitalObject,
      time: number,
      color: string,
      cx: number,
      cy: number,
      scale: number,
    ) => {
      context.strokeStyle = color;
      context.lineWidth = 1.25;
      context.globalAlpha = 0.42;
      context.beginPath();
      for (let i = 0; i <= 90; i += 1) {
        const point = projectPoint(
          orbitalPosition(object, time + (i / 90) * (Math.PI * 2) / object.angularSpeed),
          cx,
          cy,
          scale,
        );
        if (i === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.stroke();
      context.globalAlpha = 1;
    };

    const drawMonitor = (width: number, height: number, time: number) => {
      const cx = width * 0.5;
      const cy = height * 0.49;
      const earthRadius = Math.min(width, height) * 0.265 * zoomRef.current;
      const scale = earthRadius;
      const primary = orbitalObjects[currentEvent.primaryIndex];
      const secondary = orbitalObjects[currentEvent.secondaryIndex];

      drawTrail(primary, time, '#43e6c8', cx, cy, scale);
      drawTrail(secondary, time, '#ff7d68', cx, cy, scale);
      drawEarth(cx, cy, earthRadius);

      const points = orbitalObjects
        .filter((object) => filters[object.kind])
        .map((object) => ({ object, point: projectPoint(orbitalPosition(object, time), cx, cy, scale) }))
        .sort((a, b) => a.point.z - b.point.z);

      for (const { object, point } of points) {
        const dx = point.x - cx;
        const dy = point.y - cy;
        const behindEarth = point.z < 0 && dx * dx + dy * dy < earthRadius * earthRadius;
        if (behindEarth) continue;
        const isSelected = object.id === primary.id || object.id === secondary.id;
        const radius = isSelected ? 3.4 : object.kind === 'payload' ? 1.35 : 1.05;
        context.globalAlpha = isSelected ? 1 : 0.62 + Math.max(0, point.z) * 0.08;
        context.fillStyle = object.id === secondary.id ? '#ff7d68' : kindColors[object.kind];
        if (isSelected) {
          context.shadowColor = context.fillStyle;
          context.shadowBlur = 14;
        }
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      }
      context.globalAlpha = 1;

      const p1 = projectPoint(orbitalPosition(primary, time), cx, cy, scale);
      const p2 = projectPoint(orbitalPosition(secondary, time), cx, cy, scale);
      const pulse = 8 + Math.sin(performance.now() * 0.004) * 2;
      for (const [point, color] of [
        [p1, '#43e6c8'],
        [p2, '#ff7d68'],
      ] as const) {
        context.strokeStyle = color;
        context.globalAlpha = 0.8;
        context.beginPath();
        context.arc(point.x, point.y, pulse, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.setLineDash([4, 5]);
      context.strokeStyle = 'rgba(255,255,255,.52)';
      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
      context.setLineDash([]);
    };

    const drawReplay = (width: number, height: number, time: number) => {
      const cx = width * 0.5;
      const cy = height * 0.52;
      const size = Math.min(width, height) * 0.68;
      context.strokeStyle = 'rgba(109,193,255,.12)';
      context.lineWidth = 1;
      for (let i = -5; i <= 5; i += 1) {
        context.beginPath();
        context.moveTo(cx - size, cy + (i * size) / 5);
        context.lineTo(cx + size, cy + (i * size) / 5);
        context.stroke();
        context.beginPath();
        context.moveTo(cx + (i * size) / 5, cy - size);
        context.lineTo(cx + (i * size) / 5, cy + size);
        context.stroke();
      }

      context.strokeStyle = 'rgba(109,193,255,.48)';
      context.beginPath();
      context.moveTo(cx - size, cy);
      context.lineTo(cx + size, cy);
      context.moveTo(cx, cy - size);
      context.lineTo(cx, cy + size);
      context.stroke();

      context.save();
      context.translate(cx, cy);
      context.rotate(-0.24);
      context.strokeStyle = 'rgba(255,185,104,.72)';
      context.fillStyle = 'rgba(255,185,104,.08)';
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(0, 0, size * 0.27, size * 0.1, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();

      const progress = (Math.sin(time * 0.055) + 1) / 2;
      const ax = cx - size * 0.72 + progress * size * 1.42;
      const ay = cy - size * 0.36 + progress * size * 0.72;
      const bx = cx + size * 0.66 - progress * size * 1.34;
      const by = cy + size * 0.5 - progress * size * 0.98;
      context.lineWidth = 2;
      context.strokeStyle = '#43e6c8';
      context.beginPath();
      context.moveTo(cx - size * 0.72, cy - size * 0.36);
      context.lineTo(cx + size * 0.72, cy + size * 0.36);
      context.stroke();
      context.strokeStyle = '#ff7d68';
      context.beginPath();
      context.moveTo(cx + size * 0.66, cy + size * 0.5);
      context.lineTo(cx - size * 0.66, cy - size * 0.48);
      context.stroke();

      for (const [x, y, color] of [
        [ax, ay, '#43e6c8'],
        [bx, by, '#ff7d68'],
      ] as const) {
        context.shadowColor = color;
        context.shadowBlur = 18;
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
      }
      context.shadowBlur = 0;

      context.fillStyle = 'rgba(176,204,226,.7)';
      context.font = '11px var(--font-geist-mono), monospace';
      context.fillText('R  RADIAL', cx + size - 72, cy - 9);
      context.fillText('T  ALONG-TRACK', cx + 10, cy - size + 18);
      context.fillText('UNCERTAINTY ELLIPSE · MAGNIFIED', cx - 102, cy + size * 0.18);
    };

    const animate = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const delta = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      if (playing) timeRef.current += delta * speed;
      drawStars(rect.width, rect.height, now);
      if (mode === 'monitor') drawMonitor(rect.width, rect.height, timeRef.current);
      else drawReplay(rect.width, rect.height, timeRef.current);

      fpsFrames += 1;
      if (now - fpsStart > 700) {
        setFps(Math.round((fpsFrames * 1000) / (now - fpsStart)));
        fpsFrames = 0;
        fpsStart = now;
      }
      if (now - uiUpdate > 180) {
        setTimeline(Math.round(timeRef.current * 10) / 10);
        uiUpdate = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [currentEvent, filters, mode, playing, speed]);

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode);
    setPlaying(true);
    timeRef.current = 0;
    setTimeline(0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active || mode !== 'monitor') return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    rotationRef.current.yaw += dx * 0.006;
    rotationRef.current.pitch = Math.max(
      -1.1,
      Math.min(1.1, rotationRef.current.pitch + dy * 0.006),
    );
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (mode !== 'monitor') return;
    zoomRef.current = Math.max(0.78, Math.min(1.34, zoomRef.current - event.deltaY * 0.0007));
  };

  const setTimelineValue = (value: number) => {
    timeRef.current = value;
    setTimeline(value);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>ORBITSHIELD</strong>
            <small>SPACE SAFETY INTELLIGENCE</small>
          </div>
        </div>

        <nav className="mode-switch" aria-label="Visualization mode">
          <button
            className={mode === 'monitor' ? 'active' : ''}
            onClick={() => changeMode('monitor')}
          >
            <span className="nav-icon">◉</span> Orbit monitor
          </button>
          <button
            className={mode === 'replay' ? 'active' : ''}
            onClick={() => changeMode('replay')}
          >
            <span className="nav-icon">⌁</span> AI historical replay
          </button>
        </nav>

        <div className="status-cluster">
          <span className="status-dot" />
          <div>
            <strong>SNAPSHOT</strong>
            <small>DEMO CACHE · OFFLINE READY</small>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          {mode === 'monitor' ? (
            <>
              <div className="rail-heading">
                <div>
                  <span className="eyebrow">SCREENING QUEUE</span>
                  <h1>Close approaches</h1>
                </div>
                <span className="count-badge">03</span>
              </div>
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search object or event"
                />
              </label>
              <div className="filter-row" aria-label="Object filters">
                {(['payload', 'debris', 'rocket'] as ObjectKind[]).map((kind) => (
                  <button
                    key={kind}
                    className={filters[kind] ? `filter-chip ${kind}` : 'filter-chip muted'}
                    onClick={() => setFilters((value) => ({ ...value, [kind]: !value[kind] }))}
                    aria-pressed={filters[kind]}
                  >
                    <i /> {kind === 'rocket' ? 'Rocket' : kind[0].toUpperCase() + kind.slice(1)}
                  </button>
                ))}
              </div>
              <div className="event-list">
                {filteredConjunctions.map((event) => {
                  const index = conjunctions.indexOf(event);
                  return (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(index)}
                      className={index === selectedEvent ? 'event-card selected' : 'event-card'}
                    >
                      <span className={`urgency ${event.urgency.toLowerCase()}`}>
                        {event.urgency}
                      </span>
                      <span className="event-pair">
                        <strong>{event.primary}</strong>
                        <small>×</small>
                        <strong>{event.secondary}</strong>
                      </span>
                      <span className="event-meta">
                        <span><b>{event.range}</b> miss</span>
                        <span><b>{event.probability}</b> max P</span>
                      </span>
                      <span className="event-id">{event.id} · representative</span>
                    </button>
                  );
                })}
              </div>
              <div className="rail-note">
                <span>i</span>
                <p>
                  Cards are representative cached records for UI validation. Production values map directly to SOCRATES fields.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="rail-heading">
                <div>
                  <span className="eyebrow">HELD-OUT EVENT LAB</span>
                  <h1>Replay scenarios</h1>
                </div>
                <span className="count-badge purple">03</span>
              </div>
              <p className="rail-intro">
                Freeze each historical CDM sequence at T−2 days. Predict first, then reveal the final recorded risk.
              </p>
              <div className="event-list replay-list">
                {replayEvents.map((event, index) => (
                  <button
                    key={event.id}
                    onClick={() => {
                      setSelectedReplay(index);
                      setRevealed(false);
                    }}
                    className={index === selectedReplay ? 'event-card replay selected' : 'event-card replay'}
                  >
                    <span className="replay-number">0{index + 1}</span>
                    <span className="event-pair">
                      <strong>{event.label}</strong>
                      <small>{event.pattern}</small>
                    </span>
                    <span className={`priority-tag ${event.priority.toLowerCase()}`}>
                      {event.priority}
                    </span>
                  </button>
                ))}
              </div>
              <div className="model-stamp">
                <div className="model-icon">AI</div>
                <div>
                  <strong>Event-safe model</strong>
                  <span>Strict T−2 cutoff · grouped split</span>
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="scene-panel">
          <canvas
            ref={canvasRef}
            className={mode === 'monitor' ? 'space-canvas draggable' : 'space-canvas'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => (dragRef.current.active = false)}
            onPointerCancel={() => (dragRef.current.active = false)}
            onWheel={handleWheel}
            aria-label={
              mode === 'monitor'
                ? 'Animated orbital traffic visualization around Earth'
                : 'Magnified relative encounter geometry visualization'
            }
          />
          <div className="scene-title">
            <span>{mode === 'monitor' ? 'EARTH ORBIT VIEW' : 'RELATIVE ENCOUNTER VIEW'}</span>
            <strong>
              {mode === 'monitor'
                ? `${currentEvent.primary} × ${currentEvent.secondary}`
                : currentReplay.label}
            </strong>
          </div>
          <div className="scene-badge">
            <span className="pulse-dot" />
            {mode === 'monitor' ? '512 OBJECT RENDER TEST' : 'SEPARATION MAGNIFIED'}
          </div>
          {mode === 'monitor' ? (
            <div className="legend">
              <span><i className="payload" /> Active payload</span>
              <span><i className="debris" /> Debris</span>
              <span><i className="rocket" /> Rocket body</span>
            </div>
          ) : (
            <div className="replay-caption">
              Historical ESA records do not provide an honest absolute globe position. This view uses relative R–T geometry.
            </div>
          )}
          <button
            className="reset-view"
            onClick={() => {
              rotationRef.current = { yaw: -0.62, pitch: 0.28 };
              zoomRef.current = 1;
            }}
          >
            ⟳ Reset view
          </button>
          {mode === 'monitor' && (
            <div className="encounter-inset">
              <div className="inset-topline">
                <span>ENCOUNTER PLANE</span>
                <b>SEPARATION MAGNIFIED</b>
              </div>
              <div className="inset-visual">
                <span className="track track-a" />
                <span className="track track-b" />
                <i className="object-a" />
                <i className="object-b" />
                <em>{currentEvent.range}</em>
              </div>
            </div>
          )}
        </section>

        <aside className="right-rail">
          {mode === 'monitor' ? (
            <>
              <div className="detail-heading">
                <div>
                  <span className="eyebrow">CONJUNCTION DETAIL</span>
                  <h2>{currentEvent.id}</h2>
                </div>
                <span className={`urgency ${currentEvent.urgency.toLowerCase()}`}>
                  {currentEvent.urgency}
                </span>
              </div>
              <div className="object-pair-card">
                <div>
                  <span className="object-dot cyan" />
                  <small>PRIMARY</small>
                  <strong>{currentEvent.primary}</strong>
                  <em>ACTIVE PAYLOAD</em>
                </div>
                <span className="pair-divider">×</span>
                <div>
                  <span className="object-dot coral" />
                  <small>SECONDARY</small>
                  <strong>{currentEvent.secondary}</strong>
                  <em>TRACKED OBJECT</em>
                </div>
              </div>
              <div className="tca-card">
                <span>NEXT CLOSEST APPROACH</span>
                <strong>{currentEvent.tca}</strong>
                <div className="countdown">
                  <div><b>00</b><small>HR</small></div>
                  <i>:</i>
                  <div><b>18</b><small>MIN</small></div>
                  <i>:</i>
                  <div><b>42</b><small>SEC</small></div>
                </div>
              </div>
              <div className="metric-grid">
                <div><span>MINIMUM RANGE</span><strong>{currentEvent.range}</strong></div>
                <div><span>RELATIVE SPEED</span><strong>{currentEvent.speed}</strong></div>
                <div><span>MAX PROBABILITY</span><strong>{currentEvent.probability}</strong></div>
                <div><span>DILUTION</span><strong>{currentEvent.dilution}</strong></div>
              </div>
              <div className="source-card">
                <span className="source-icon">◎</span>
                <div>
                  <strong>Schema: CelesTrak SOCRATES</strong>
                  <small>Prototype cache · values are representative</small>
                </div>
              </div>
              <button className="primary-action" onClick={() => changeMode('replay')}>
                Explain risk with AI replay <span>→</span>
              </button>
              <p className="safety-note">
                Educational screening prototype. Not an operational collision warning or manoeuvre recommendation.
              </p>
            </>
          ) : (
            <>
              <div className="detail-heading">
                <div>
                  <span className="eyebrow">T−2 DAY INFERENCE</span>
                  <h2>{currentReplay.id}</h2>
                </div>
                <span className={`priority-tag ${currentReplay.priority.toLowerCase()}`}>
                  {currentReplay.priority}
                </span>
              </div>
              <div className="prediction-hero">
                <span>PREDICTED FINAL LOG₁₀ RISK</span>
                <strong>{currentReplay.prediction.toFixed(2)}</strong>
                <small>P ≈ {shortProbability(currentReplay.prediction)}</small>
                <div className="prediction-band">
                  <span style={{ left: `${Math.max(8, Math.min(92, (currentReplay.prediction + 7) * 25))}%` }} />
                </div>
                <div className="band-labels"><span>LOW</span><span>REVIEW</span><span>HIGH</span></div>
              </div>
              <div className="comparison-card">
                <div>
                  <span>LATEST-KNOWN BASELINE</span>
                  <strong>{currentReplay.baseline.toFixed(2)}</strong>
                </div>
                <div className="arrow-divider">→</div>
                <div>
                  <span>MODEL AT T−2 DAYS</span>
                  <strong>{currentReplay.prediction.toFixed(2)}</strong>
                </div>
              </div>
              <div className="feature-section">
                <div className="section-label">
                  <span>TOP FEATURE SIGNALS</span>
                  <small>relative contribution</small>
                </div>
                {currentReplay.features.map((feature) => (
                  <div className="feature-row" key={feature.label}>
                    <span>{feature.label}</span>
                    <div><i style={{ width: `${feature.value}%` }} /></div>
                    <b className={feature.direction}>{feature.direction === 'up' ? '↗' : '↘'}</b>
                  </div>
                ))}
              </div>
              <button className={revealed ? 'reveal-button revealed' : 'reveal-button'} onClick={() => setRevealed(true)}>
                {revealed ? (
                  <><span>FINAL RECORDED RISK</span><strong>{currentReplay.finalRisk.toFixed(2)}</strong><small>absolute error {Math.abs(currentReplay.finalRisk - currentReplay.prediction).toFixed(2)}</small></>
                ) : (
                  <><span>Reveal historical outcome</span><b>◌</b></>
                )}
              </button>
              <div className="source-card purple-source">
                <span className="source-icon">AI</span>
                <div>
                  <strong>ESA Collision Avoidance dataset</strong>
                  <small>Representative saved prediction · event-safe split</small>
                </div>
              </div>
              <p className="safety-note">
                The production pipeline must train and validate on event-grouped ESA CDMs. This shell demonstrates the judge-facing interaction.
              </p>
            </>
          )}
        </aside>
      </section>

      <footer className="timebar">
        <div className="telemetry">
          <div><span>RENDERED</span><strong>512</strong><small>objects</small></div>
          <div><span>FRAME RATE</span><strong>{Math.min(99, fps)}</strong><small>fps</small></div>
          <div><span>MODE</span><strong>{mode === 'monitor' ? 'ECEF' : 'R–T–N'}</strong><small>frame</small></div>
        </div>
        <div className="transport">
          <button onClick={() => setTimelineValue(Math.max(0, timeline - 5))} aria-label="Step backward">−5</button>
          <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <button onClick={() => setTimelineValue(Math.min(120, timeline + 5))} aria-label="Step forward">+5</button>
        </div>
        <div className="timeline-control">
          <span>{mode === 'monitor' ? 'TCA − 15 MIN' : 'T − 7 DAYS'}</span>
          <input
            type="range"
            min="0"
            max="120"
            step="0.1"
            value={Math.min(120, timeline)}
            onChange={(event) => setTimelineValue(Number(event.target.value))}
            aria-label="Simulation timeline"
          />
          <span>{mode === 'monitor' ? 'TCA + 15 MIN' : 'T − 2 DAYS'}</span>
        </div>
        <div className="speed-control" aria-label="Playback speed">
          {[1, 10, 60].map((value) => (
            <button key={value} className={speed === value ? 'active' : ''} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
        </div>
        <time>21 AUG 2026 · {new Date(Date.UTC(2026, 7, 21, 10, 0, 0) + timeline * 1000).toISOString().slice(11, 19)} UTC</time>
      </footer>
    </main>
  );
}
