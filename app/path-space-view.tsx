'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, X } from 'lucide-react';

import { buildPathSpace, type PathSeries } from './lib/path-space';
import type { ManeuverAssumptions, ManeuverCandidate } from './lib/maneuver';
import type { ConjunctionRecord, OmmRecord } from './lib/types';

const ROLE_COLOR: Record<PathSeries['role'], number> = {
  current: 0xff4452,
  best: 0x50d9b3,
  alternative: 0x4d9dff,
};

const ROLE_CSS: Record<PathSeries['role'], string> = {
  current: '#ff4452',
  best: '#50d9b3',
  alternative: '#4d9dff',
};

const DEBRIS_COLOR = 0xf0b24a;
const DEBRIS_CSS = '#f0b24a';

/** Scene units the widest path is scaled to, so every encounter frames alike. */
const WORLD_HALF_EXTENT = 10;

const FRAMINGS = [
  { id: 'close', label: 'Close', multiplier: 3 },
  { id: 'medium', label: 'Medium', multiplier: 8 },
  { id: 'wide', label: 'Wide', multiplier: 22 },
] as const;

type FramingId = (typeof FRAMINGS)[number]['id'];

/**
 * Text drawn once into a canvas texture.
 *
 * Sprites are the expensive part of this scene, so the count is kept small and
 * deliberate: axis names, the two start points and each closest approach. Tick
 * values live in the sidebar instead, where they cost nothing.
 */
function labelSprite(text: string, color: string, pixelHeight = 26) {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  const font = `600 ${pixelHeight}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  measure.font = font;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(measure.measureText(text).width) + 16;
  canvas.height = pixelHeight + 14;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = font;
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, 8, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const worldHeight = pixelHeight / 26 * 0.62;
  const factor = worldHeight / canvas.height;
  sprite.scale.set(canvas.width * factor, canvas.height * factor, 1);
  return sprite;
}

function markerMesh(color: number, radius: number, disposables: THREE.Object3D[]) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 10),
    new THREE.MeshBasicMaterial({ color }),
  );
  disposables.push(mesh);
  return mesh;
}

export default function PathSpaceView({
  event,
  protectedRecord,
  counterpartRecord,
  candidates,
  recommendedId,
  assumptions,
  onClose,
}: {
  event: ConjunctionRecord;
  protectedRecord: OmmRecord | null | undefined;
  counterpartRecord: OmmRecord | null | undefined;
  candidates: ManeuverCandidate[];
  recommendedId: string | null;
  assumptions: ManeuverAssumptions;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [framing, setFraming] = useState<FramingId>('medium');

  // The encounter is a snapshot. The workspace clock re-renders this component's
  // parent twice a second, and rebuilding the scene on each of those was what
  // made the view unusable, so the inputs are captured once when it opens.
  const [frozen] = useState(() => ({ event, protectedRecord, counterpartRecord, candidates, recommendedId }));

  const space = useMemo(() => buildPathSpace({
    event: frozen.event,
    protectedRecord: frozen.protectedRecord,
    counterpartRecord: frozen.counterpartRecord,
    candidates: frozen.candidates,
    recommendedId: frozen.recommendedId,
    samples: 49,
    windowMultiplier: FRAMINGS.find((item) => item.id === framing)!.multiplier,
  }), [framing, frozen]);

  const hasSpace = Boolean(space);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const fitBoxRef = useRef<THREE.Box3 | null>(null);
  const invalidateRef = useRef<() => void>(() => {});

  const fitToView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    // Frame the geometry that exists rather than a guessed radius, so both start
    // points and the closest approach are always inside the view.
    const box = fitBoxRef.current;
    const sphere = box && !box.isEmpty()
      ? box.getBoundingSphere(new THREE.Sphere())
      : new THREE.Sphere(new THREE.Vector3(), WORLD_HALF_EXTENT);
    const vertical = Math.tan((camera.fov * Math.PI) / 360);
    const horizontal = vertical * Math.max(camera.aspect, 0.2);
    const distance = (sphere.radius * 1.12) / Math.min(vertical, horizontal);

    const direction = new THREE.Vector3(0.62, -0.68, 0.39).normalize();
    camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    controls.target.copy(sphere.center);
    controls.maxDistance = Math.max(120, distance * 6);
    controls.minDistance = Math.max(0.4, sphere.radius * 0.05);
    controls.update();
    invalidateRef.current();
  }, []);

  // Renderer, camera and controls are built once and survive every re-render.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasSpace) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 4000);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 1.5;
    controls.maxDistance = 900;

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;

    // Rendering happens only when something actually changes. A static plot has
    // no reason to hold a 60 Hz loop open.
    let queued = false;
    let settling = 0;
    const render = () => {
      queued = false;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving || settling > 0) {
        settling = moving ? 12 : settling - 1;
        invalidate();
      }
    };
    const invalidate = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(render);
    };
    invalidateRef.current = () => { settling = 12; invalidate(); };
    controls.addEventListener('change', invalidate);

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
  }, [fitToView, hasSpace]);

  // Only the drawn content is rebuilt when the framing or the visible set changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !space) return;

    const group = new THREE.Group();
    const owned: THREE.Object3D[] = [];
    const scale = WORLD_HALF_EXTENT / space.extentKm;
    const fitBox = new THREE.Box3();

    const line = (points: THREE.Vector3[], color: number, opacity: number, dashed = false) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.34, gapSize: 0.26 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const mesh = new THREE.Line(geometry, material);
      if (dashed) mesh.computeLineDistances();
      owned.push(mesh);
      return mesh;
    };

    const grid = new THREE.GridHelper(WORLD_HALF_EXTENT * 2, 10, 0x2b3a44, 0x161f25);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    owned.push(grid);
    group.add(grid);

    const axes: Array<[THREE.Vector3, string]> = [
      [new THREE.Vector3(1, 0, 0), 'ALONG-TRACK +T'],
      [new THREE.Vector3(0, 1, 0), 'CROSS-TRACK +N'],
      [new THREE.Vector3(0, 0, 1), 'RADIAL +R (altitude)'],
    ];
    for (const [direction, label] of axes) {
      const end = direction.clone().multiplyScalar(WORLD_HALF_EXTENT * 1.08);
      group.add(line([end.clone().negate(), end], 0x7d919e, 0.42));
      const sprite = labelSprite(label, '#93a8b6', 24);
      if (sprite) {
        sprite.position.copy(end).add(direction.clone().multiplyScalar(1.1));
        owned.push(sprite);
        group.add(sprite);
      }
    }

    const toWorld = (point: { x: number; y: number; z: number }) => {
      const vector = new THREE.Vector3(point.x * scale, point.y * scale, point.z * scale);
      fitBox.expandByPoint(vector);
      return vector;
    };

    // The counterpart gets a full track of its own, so the picture shows two
    // objects converging rather than one object passing a fixed dot.
    const debrisPoints = space.counterpartPoints.map(toWorld);
    group.add(line(debrisPoints, DEBRIS_COLOR, 0.95));
    const debrisStart = markerMesh(DEBRIS_COLOR, 0.3, owned);
    debrisStart.position.copy(debrisPoints[0]);
    group.add(debrisStart);
    const debrisStartLabel = labelSprite('DEBRIS START', DEBRIS_CSS, 22);
    if (debrisStartLabel) {
      debrisStartLabel.position.copy(debrisPoints[0]).add(new THREE.Vector3(0, 0, 0.75));
      owned.push(debrisStartLabel);
      group.add(debrisStartLabel);
    }

    let closestPair: { sat: THREE.Vector3; deb: THREE.Vector3 } | null = null;

    for (const series of space.series) {
      if (hidden.has(series.id)) continue;
      const color = ROLE_COLOR[series.role];
      const points = series.points.map(toWorld);
      group.add(line(points, color, series.role === 'alternative' ? 0.7 : 1));

      const closest = toWorld(series.closestPoint);
      const marker = markerMesh(color, series.role === 'alternative' ? 0.17 : 0.26, owned);
      marker.position.copy(closest);
      group.add(marker);

      const distanceLabel = labelSprite(`${series.closestApproachKm.toFixed(3)} km`, ROLE_CSS[series.role], 22);
      if (distanceLabel) {
        distanceLabel.position.copy(closest).add(new THREE.Vector3(0.4, 0.4, 0.5));
        owned.push(distanceLabel);
        group.add(distanceLabel);
      }

      if (series.role === 'current') {
        const start = markerMesh(color, 0.3, owned);
        start.position.copy(points[0]);
        group.add(start);
        const startLabel = labelSprite('SATELLITE START', ROLE_CSS.current, 22);
        if (startLabel) {
          startLabel.position.copy(points[0]).add(new THREE.Vector3(0, 0, 0.75));
          owned.push(startLabel);
          group.add(startLabel);
        }
        const index = series.points.indexOf(series.closestPoint);
        if (index >= 0 && debrisPoints[index]) {
          closestPair = { sat: closest, deb: debrisPoints[index] };
        }
      }

      if (series.burnDirection) {
        const direction = new THREE.Vector3(series.burnDirection.x, series.burnDirection.y, series.burnDirection.z);
        const arrow = new THREE.ArrowHelper(direction, points[0], 2.4, color, 0.85, 0.42);
        owned.push(arrow);
        group.add(arrow);
        const burnLabel = labelSprite(series.burnLabel ?? '', ROLE_CSS[series.role], 20);
        if (burnLabel) {
          burnLabel.position.copy(points[0]).add(direction.clone().multiplyScalar(2.9));
          owned.push(burnLabel);
          group.add(burnLabel);
        }
      }
    }

    // The miss distance drawn as a length between the two objects at the moment
    // it matters, rather than only as a number in the legend.
    if (closestPair) {
      group.add(line([closestPair.sat, closestPair.deb], 0xffffff, 0.5, true));
    }

    scene.add(group);
    contentRef.current = group;
    fitBoxRef.current = fitBox;
    fitToView();

    return () => {
      scene.remove(group);
      for (const item of owned) {
        const mesh = item as THREE.Mesh | THREE.Line | THREE.Sprite;
        (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose?.();
      }
      contentRef.current = null;
    };
  }, [fitToView, hidden, space]);

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return <div className="ops-pathspace" role="dialog" aria-label="Three-dimensional path comparison">
    <header>
      <div>
        <b>PATH SPACE</b>
        <h2>{frozen.event.primaryName} &#8596; {frozen.event.secondaryName}</h2>
        <small>
          Local orbital axes centred on where the satellite would be at closest approach. Along-track and cross-track
          span the horizontal plane, radial is altitude, and distances are true to scale in every direction.
        </small>
      </div>
      <div className="ops-pathspace-actions">
        <div className="ops-pathspace-framing" role="group" aria-label="Corridor length">
          {FRAMINGS.map((item) => (
            <button
              key={item.id}
              aria-pressed={framing === item.id}
              className={framing === item.id ? 'active' : ''}
              onClick={() => setFraming(item.id)}
            >{item.label}</button>
          ))}
        </div>
        <button onClick={fitToView} aria-label="Fit everything in view" title="Fit everything in view"><Maximize2 size={15} /></button>
        <button onClick={onClose} aria-label="Close the path comparison"><X size={16} /></button>
      </div>
    </header>

    {!space ? (
      <div className="ops-pathspace-empty">
        <p>This pair does not have the public orbit records needed to rebuild the encounter geometry.</p>
      </div>
    ) : (
      <div className="ops-pathspace-body">
        <div className="ops-pathspace-canvas" ref={hostRef} />
        <aside>
          <div className="ops-pathspace-legend">
            <div className="ops-pathspace-static">
              <i style={{ background: DEBRIS_CSS }} />
              <span><strong>{frozen.event.secondaryName}</strong><em>The counterpart, on its own track</em></span>
            </div>
            {space.series.map((series) => (
              <button
                key={series.id}
                className={`${series.role} ${hidden.has(series.id) ? 'off' : ''}`}
                aria-pressed={!hidden.has(series.id)}
                onClick={() => toggle(series.id)}
              >
                <i style={{ background: ROLE_CSS[series.role] }} />
                <span>
                  <strong>{series.label}</strong>
                  <em>{series.detail}</em>
                  <b>{series.separationAtTcaKm.toFixed(3)} km at the published TCA</b>
                  {Math.abs(series.separationAtTcaKm - series.closestApproachKm) > series.separationAtTcaKm * 0.01
                    && <u>true minimum {series.closestApproachKm.toFixed(3)} km, the burn shifts when it happens</u>}
                </span>
              </button>
            ))}
          </div>
          <div className="ops-pathspace-facts">
            <span><small>Corridor</small><strong>{space.windowSeconds.toFixed(1)} s</strong></span>
            <span><small>Each object flies</small><strong>{space.travelKm.toFixed(1)} km</strong></span>
            <span><small>Published miss</small><strong>{space.sourceMissDistanceKm.toFixed(3)} km</strong></span>
            <span><small>Closing speed</small><strong>{space.relativeSpeedKmS.toFixed(3)} km/s</strong></span>
            <span><small>Example mass</small><strong>{assumptions.spacecraftMassKg.toLocaleString('en-IN')} kg</strong></span>
            <span><small>Example Isp</small><strong>{assumptions.specificImpulseSeconds} s</strong></span>
          </div>
          <p className="ops-pathspace-note">
            Arrows show the direction the thruster pushes for each candidate, in the same R-T-N axes as the plot. The
            dashed white line is the miss distance at the moment it matters.
          </p>
          <p className="ops-pathspace-note">{space.model}</p>
          <p className="ops-pathspace-note">
            Where a path lists a true minimum below its value at the published time, the burn has moved the encounter
            slightly earlier or later as well as further away. The manoeuvre panel quotes the fixed-time figure.
          </p>
          <p className="ops-pathspace-note">
            Post-manoeuvre collision probability is still withheld. It needs an operator CDM with covariance, and no
            picture changes that.
          </p>
        </aside>
      </div>
    )}
  </div>;
}
