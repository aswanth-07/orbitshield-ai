'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';

import {
  CATALOG_SATELLITE_COLOR,
  MONITORED_SATELLITE_COLOR,
  objectMarkerColor,
  orbitVisualStyle,
  RISK_ORBIT_COLOR,
  type TcaReplayFrame,
  type TcaReplayPhase,
} from './lib/collision-visualization';
import { prepareOmm, propagateOmm, propagatePreparedOmm, sampleOrbitPath, sampleOrbitSegment } from './lib/orbit';
import type { ConjunctionRecord, OmmRecord, OrbitPath, PropagatedObject, ThreatObject } from './lib/types';
import PropagationWorker from './workers/propagation.worker.ts?worker';

export type OrbitCameraMode = 'global' | 'follow' | 'pair-follow' | 'encounter' | 'free';

type OrbitGlobeProps = {
  catalogue: OmmRecord[];
  focusRecords: OmmRecord[];
  threats: ThreatObject[];
  fleetIds: number[];
  selectedEvent: ConjunctionRecord | null;
  selectedSatelliteId: number | null;
  cameraMode: OrbitCameraMode;
  cameraResetKey: number;
  previewId: number | null;
  focusCatalogId: number | null;
  simulationTime: number;
  contextTime?: number;
  trajectoryStartTime?: number | null;
  showCatalogue: boolean;
  focusSelectedOnly?: boolean;
  showFleetLabels?: boolean;
  replayPhase: TcaReplayPhase | null;
  replayActive: boolean;
  replayFrameRef: RefObject<TcaReplayFrame | null>;
  onObjectSelect: (catalogId: number) => void;
};

type ScenePoint = PropagatedObject & {
  color: string;
  radius: number;
  role: string;
  selected: boolean;
  selectable: boolean;
  markerKind: 'satellite' | 'debris' | 'tca' | 'cpa';
  threat?: ThreatObject;
};

const RENDERER_CONFIG = { antialias: false, alpha: true, powerPreference: 'high-performance' as const };

function closestApproachTarget() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, 128, 128);
  context.strokeStyle = '#ff4452';
  context.lineWidth = 7;
  context.shadowColor = '#ff2438';
  context.shadowBlur = 18;
  context.beginPath();
  context.arc(64, 64, 39, 0, Math.PI * 2);
  context.stroke();
  context.shadowBlur = 8;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(64, 5);
  context.lineTo(64, 34);
  context.moveTo(64, 94);
  context.lineTo(64, 123);
  context.moveTo(5, 64);
  context.lineTo(34, 64);
  context.moveTo(94, 64);
  context.lineTo(123, 64);
  context.stroke();
  context.fillStyle = '#fff';
  context.beginPath();
  context.arc(64, 64, 4, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  }));
  sprite.scale.set(11, 11, 1);
  sprite.name = 'closest-approach-target';
  return sprite;
}

function markerObject(point: ScenePoint) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.96 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(point.radius * 2.4, 14, 14), material);
  group.add(sphere);
  if (point.markerKind === 'cpa') {
    const target = closestApproachTarget();
    if (target) group.add(target);
  } else if (point.selected) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(point.radius * 4.6, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.58 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  if (point.selectable) {
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(1.2, point.radius * 5.2), 8, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitTarget.name = 'marker-hit-target';
    group.add(hitTarget);
  }
  return group;
}

function midpoint(first: PropagatedObject, second: PropagatedObject) {
  const toCartesian = ({ lat, lng }: PropagatedObject) => {
    const latitude = THREE.MathUtils.degToRad(lat);
    const longitude = THREE.MathUtils.degToRad(lng);
    return new THREE.Vector3(
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude),
    );
  };
  const center = toCartesian(first).add(toCartesian(second)).normalize();
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(center.z)),
    lng: THREE.MathUtils.radToDeg(Math.atan2(center.y, center.x)),
    altitude: (first.altitude + second.altitude) / 2,
    altitudeKm: (first.altitudeKm + second.altitudeKm) / 2,
  };
}

export default function OrbitGlobe({
  catalogue,
  focusRecords,
  threats,
  fleetIds,
  selectedEvent,
  selectedSatelliteId,
  cameraMode,
  cameraResetKey,
  previewId,
  focusCatalogId,
  simulationTime,
  contextTime = simulationTime,
  trajectoryStartTime = null,
  showCatalogue,
  focusSelectedOnly = true,
  showFleetLabels = false,
  replayPhase,
  replayActive,
  replayFrameRef,
  onObjectSelect,
}: OrbitGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const workerRef = useRef<Worker | null>(null);
  const cataloguePropagationInFlightRef = useRef(false);
  const queuedCatalogueTimeRef = useRef<number | null>(null);
  const cloudRef = useRef<THREE.Points | null>(null);
  const threatCloudRef = useRef<THREE.Points | null>(null);
  const markerCacheRef = useRef(new Map<string, THREE.Object3D>());
  const markerByCatalogIdRef = useRef(new Map<number, THREE.Object3D>());
  const onObjectSelectRef = useRef(onObjectSelect);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const followedTargetRef = useRef<THREE.Vector3 | null>(null);
  const positionedCameraKeyRef = useRef('');
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [cataloguePoints, setCataloguePoints] = useState<PropagatedObject[]>([]);
  const [globeReady, setGlobeReady] = useState(false);
  const catalogueTime = Math.floor(contextTime / 10_000) * 10_000;
  const backgroundTime = Math.floor(contextTime / 2_000) * 2_000;

  const requestCataloguePropagation = useCallback((timestamp: number) => {
    const worker = workerRef.current;
    if (!worker) return;
    if (cataloguePropagationInFlightRef.current) {
      queuedCatalogueTimeRef.current = timestamp;
      return;
    }
    cataloguePropagationInFlightRef.current = true;
    worker.postMessage({ type: 'propagate', timestamp });
  }, []);

  useEffect(() => {
    onObjectSelectRef.current = onObjectSelect;
  }, [onObjectSelect]);

  const renderMarker = useCallback((point: object) => {
    const item = point as ScenePoint;
    const key = `${item.markerKind}:${item.catalogId}:${item.color}:${item.radius}:${item.selected ? 1 : 0}:${item.selectable ? 1 : 0}`;
    const cached = markerCacheRef.current.get(key);
    if (cached) {
      markerByCatalogIdRef.current.set(item.catalogId, cached);
      return cached;
    }
    const marker = markerObject(item);
    markerCacheRef.current.set(key, marker);
    markerByCatalogIdRef.current.set(item.catalogId, marker);
    return marker;
  }, []);
  const markerLabel = useCallback((point: object) => {
    const item = point as ScenePoint;
    if (!item.selectable) return `${item.name} · ${item.role}`;
    return `${item.name} · NORAD ${item.catalogId} · ${item.altitudeKm.toFixed(0)} km · ${item.role}${item.threat ? ` · ${item.threat.eventCount} risk event${item.threat.eventCount === 1 ? '' : 's'}` : ''}`;
  }, []);
  const selectMarker = useCallback((point: object) => {
    const item = point as ScenePoint;
    if (item.selectable) onObjectSelectRef.current(item.catalogId);
  }, []);
  const labelAltitude = useCallback((point: object) => (point as ScenePoint).altitude + 0.045, []);
  const labelColor = useCallback((point: object) => (point as ScenePoint).color, []);
  const labelSize = useCallback((point: object) => (point as ScenePoint).markerKind === 'cpa' ? 0.48 : 0.36, []);
  const pathColor = useCallback((path: object) => (path as OrbitPath).color, []);
  const pathStroke = useCallback((path: object) => (path as OrbitPath).stroke ?? 0.5, []);
  const pathDashLength = useCallback((path: object) => (path as OrbitPath).dashLength ?? 1, []);
  const pathDashGap = useCallback((path: object) => (path as OrbitPath).dashGap ?? 0, []);
  const pathDashAnimateTime = useCallback((path: object) => (path as OrbitPath).dashAnimateTime ?? 0, []);

  const configureGlobe = useCallback(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.rotateSpeed = 0.62;
    controls.panSpeed = 0.82;
    controls.zoomSpeed = 0.85;
    controls.minDistance = 18;
    controls.maxDistance = 820;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    globeRef.current.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    globeRef.current.pointOfView({ lat: 18, lng: 78, altitude: 2.15 }, 0);
    setGlobeReady(true);
  }, []);

  useEffect(() => {
    if (globeReady) return;
    // react-globe.gl occasionally misses onGlobeReady after an in-place viewport
    // reload. The renderer and ref are already available, so configure them once
    // after a short grace period instead of leaving the workspace blocked.
    const fallback = window.setTimeout(configureGlobe, 1_200);
    return () => window.clearTimeout(fallback);
  }, [configureGlobe, globeReady]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(360, Math.round(entry.contentRect.height)),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!catalogue.length || typeof Worker === 'undefined') return;
    const worker = new PropagationWorker();
    workerRef.current = worker;
    worker.postMessage({ type: 'init', objects: catalogue });
    worker.onmessage = (event: MessageEvent<{ type: string; points: PropagatedObject[] }>) => {
      if (event.data.type !== 'points') return;
      cataloguePropagationInFlightRef.current = false;
      setCataloguePoints(event.data.points);
      const queuedTime = queuedCatalogueTimeRef.current;
      queuedCatalogueTimeRef.current = null;
      if (queuedTime !== null) requestCataloguePropagation(queuedTime);
    };
    const initialTimer = window.setTimeout(() => requestCataloguePropagation(Date.now()), 180);
    return () => {
      window.clearTimeout(initialTimer);
      worker.terminate();
      workerRef.current = null;
      cataloguePropagationInFlightRef.current = false;
      queuedCatalogueTimeRef.current = null;
    };
  }, [catalogue, requestCataloguePropagation]);

  useEffect(() => {
    if (!workerRef.current || !showCatalogue || !catalogueTime || selectedEvent || replayActive) return;
    requestCataloguePropagation(catalogueTime);
  }, [catalogueTime, replayActive, requestCataloguePropagation, selectedEvent, showCatalogue]);

  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    const scene = globeRef.current.scene();
    if (cloudRef.current) {
      scene.remove(cloudRef.current);
      cloudRef.current.geometry.dispose();
      (cloudRef.current.material as THREE.Material).dispose();
      cloudRef.current = null;
    }
    if (!showCatalogue || !cataloguePoints.length) return;

    const positions = new Float32Array(cataloguePoints.length * 3);
    cataloguePoints.forEach((point, index) => {
      const coords = globeRef.current!.getCoords(point.lat, point.lng, point.altitude);
      positions[index * 3] = coords.x;
      positions[index * 3 + 1] = coords.y;
      positions[index * 3 + 2] = coords.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: CATALOG_SATELLITE_COLOR,
      size: 0.48,
      opacity: 0.68,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'active-catalogue-context';
    cloudRef.current = points;
    scene.add(points);

    return () => {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      if (cloudRef.current === points) cloudRef.current = null;
    };
  }, [cataloguePoints, globeReady, showCatalogue]);

  useEffect(() => {
    if (!globeReady || !showCatalogue || !globeRef.current) return;
    const canvas = globeRef.current.renderer().domElement;
    const onPointerDown = (event: PointerEvent) => {
      pointerOriginRef.current = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const origin = pointerOriginRef.current;
      pointerOriginRef.current = null;
      if (!origin || event.button !== 0 || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) return;
      const cloud = cloudRef.current;
      const globe = globeRef.current;
      if (!cloud || !globe) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.params.Points.threshold = 1.15;
      raycaster.setFromCamera(pointer, globe.camera());
      const hit = raycaster.intersectObject(cloud, false)[0];
      if (typeof hit?.index === 'number') {
        const point = cataloguePoints[hit.index];
        if (point) onObjectSelectRef.current(point.catalogId);
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [cataloguePoints, globeReady, showCatalogue]);

  const selectedIds = useMemo(
    () => selectedEvent ? [selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId] : [],
    [selectedEvent],
  );

  const preparedFocusRecords = useMemo(() => focusRecords.flatMap((record) => {
    const prepared = prepareOmm(record);
    return prepared ? [{ record, prepared }] : [];
  }), [focusRecords]);

  const preparedThreats = useMemo(() => new Map(threats.flatMap((threat) => {
    if (!threat.record) return [];
    const prepared = prepareOmm(threat.record);
    return prepared ? [[threat.catalogId, prepared] as const] : [];
  })), [threats]);

  const reviewPair = useMemo(() => {
    if (!selectedEvent) return null;
    const pairIds = new Set([selectedEvent.primaryCatalogId, selectedEvent.secondaryCatalogId]);
    const protectedCatalogId = selectedSatelliteId && pairIds.has(selectedSatelliteId)
      ? selectedSatelliteId
      : selectedEvent.primaryCatalogId;
    const counterpartCatalogId = protectedCatalogId === selectedEvent.primaryCatalogId
      ? selectedEvent.secondaryCatalogId
      : selectedEvent.primaryCatalogId;
    const counterpartThreat = threats.find((threat) => threat.catalogId === counterpartCatalogId);
    const counterpartRecord = focusRecords.find((record) => Number(record.NORAD_CAT_ID) === counterpartCatalogId);
    return {
      protectedCatalogId,
      counterpartCatalogId,
      counterpartColor: objectMarkerColor(counterpartThreat?.objectType ?? counterpartRecord?.OBJECT_TYPE, counterpartThreat?.size),
    };
  }, [focusRecords, selectedEvent, selectedSatelliteId, threats]);

  const movingFocusIds = useMemo(
    () => selectedEvent ? selectedIds : selectedSatelliteId ? [selectedSatelliteId] : [],
    [selectedEvent, selectedIds, selectedSatelliteId],
  );

  const focusPoint = useCallback(({ record, prepared }: (typeof preparedFocusRecords)[number], timestamp: number) => {
      const catalogId = Number(record.NORAD_CAT_ID);
      if (focusSelectedOnly && selectedEvent && !selectedIds.includes(catalogId)) return [];
      if (!selectedEvent && selectedSatelliteId && !showCatalogue && catalogId !== selectedSatelliteId) return [];
      const selected = selectedIds.includes(catalogId) || selectedSatelliteId === catalogId;
      const monitored = fleetIds.includes(catalogId);
      const point = propagatePreparedOmm(prepared, new Date(timestamp));
      if (!point) return [];
      return [{
        ...point,
        color: monitored ? MONITORED_SATELLITE_COLOR : CATALOG_SATELLITE_COLOR,
        radius: selected ? 0.36 : previewId === point.catalogId ? 0.3 : 0.21,
        role: selectedIds.includes(point.catalogId) ? 'selected conjunction satellite' : fleetIds.includes(point.catalogId) ? 'active watchlist satellite' : 'satellite search preview',
        selected,
        selectable: true,
        markerKind: 'satellite' as const,
      }];
  }, [fleetIds, focusSelectedOnly, previewId, selectedEvent, selectedIds, selectedSatelliteId, showCatalogue]);

  const backgroundInteractivePoints = useMemo<ScenePoint[]>(() => preparedFocusRecords.flatMap((prepared) => {
    const catalogId = Number(prepared.record.NORAD_CAT_ID);
    return movingFocusIds.includes(catalogId) ? [] : focusPoint(prepared, backgroundTime);
  }), [backgroundTime, focusPoint, movingFocusIds, preparedFocusRecords]);

  const movingInteractivePoints = useMemo<ScenePoint[]>(() => preparedFocusRecords.flatMap((prepared) => {
    const catalogId = Number(prepared.record.NORAD_CAT_ID);
    return movingFocusIds.includes(catalogId) ? focusPoint(prepared, simulationTime) : [];
  }), [focusPoint, movingFocusIds, preparedFocusRecords, simulationTime]);

  const interactivePoints = useMemo(
    () => [...backgroundInteractivePoints, ...movingInteractivePoints],
    [backgroundInteractivePoints, movingInteractivePoints],
  );

  const scenePointForThreat = useCallback((threat: ThreatObject, timestamp: number) => {
    if (!selectedEvent && selectedSatelliteId && !showCatalogue && threat.catalogId !== selectedSatelliteId) return [];
    const prepared = preparedThreats.get(threat.catalogId);
    if (!prepared) return [];
    const point = propagatePreparedOmm(prepared, new Date(timestamp));
    if (!point) return [];
    const selected = selectedIds.includes(threat.catalogId) || selectedSatelliteId === threat.catalogId;
    const satellite = threat.objectType === 'PAY' || threat.objectType === 'PAYLOAD';
    const eventCounterpart = Boolean(selectedEvent && reviewPair?.counterpartCatalogId === threat.catalogId);
    return [{
      ...point,
      color: eventCounterpart
        ? RISK_ORBIT_COLOR
        : satellite && fleetIds.includes(threat.catalogId)
          ? MONITORED_SATELLITE_COLOR
          : objectMarkerColor(threat.objectType, threat.size),
      radius: (satellite ? 0.2 : threat.size === 'large' ? 0.33 : threat.size === 'medium' ? 0.27 : 0.21) + (selected ? 0.12 : 0),
      role: satellite ? 'satellite conjunction object' : `${threat.size} ${threat.objectType === 'R/B' ? 'rocket body' : 'debris risk object'}`,
      selected,
      selectable: true,
      markerKind: satellite ? 'satellite' as const : 'debris' as const,
      threat,
    }];
  }, [fleetIds, preparedThreats, reviewPair, selectedEvent, selectedIds, selectedSatelliteId, showCatalogue]);

  const backgroundThreatPoints = useMemo<ScenePoint[]>(() => threats.flatMap((threat) => {
    if (selectedIds.includes(threat.catalogId)) return [];
    if (focusSelectedOnly && selectedEvent) return [];
    return scenePointForThreat(threat, backgroundTime);
  }), [backgroundTime, focusSelectedOnly, scenePointForThreat, selectedEvent, selectedIds, threats]);

  const selectedThreatPoints = useMemo<ScenePoint[]>(() => threats.flatMap((threat) => {
    if (!selectedIds.includes(threat.catalogId)) return [];
    return scenePointForThreat(threat, simulationTime);
  }), [scenePointForThreat, selectedIds, simulationTime, threats]);

  const threatPoints = useMemo(
    () => [...backgroundThreatPoints, ...selectedThreatPoints],
    [backgroundThreatPoints, selectedThreatPoints],
  );

  useEffect(() => {
    if (!globeReady || !globeRef.current || !backgroundThreatPoints.length) return;
    const scene = globeRef.current.scene();
    const positions = new Float32Array(backgroundThreatPoints.length * 3);
    const colors = new Float32Array(backgroundThreatPoints.length * 3);
    backgroundThreatPoints.forEach((point, index) => {
      const coords = globeRef.current!.getCoords(point.lat, point.lng, point.altitude);
      const color = new THREE.Color(point.color);
      positions[index * 3] = coords.x;
      positions[index * 3 + 1] = coords.y;
      positions[index * 3 + 2] = coords.z;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.95,
      opacity: 0.9,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.name = 'screened-risk-object-context';
    threatCloudRef.current = cloud;
    scene.add(cloud);
    return () => {
      scene.remove(cloud);
      geometry.dispose();
      material.dispose();
      if (threatCloudRef.current === cloud) threatCloudRef.current = null;
    };
  }, [backgroundThreatPoints, globeReady]);

  const threatIds = useMemo(() => new Set(selectedThreatPoints.map((point) => point.catalogId)), [selectedThreatPoints]);
  const pairRecords = useMemo(() => {
    if (!selectedEvent) return [];
    const recordById = new Map(focusRecords.map((record) => [Number(record.NORAD_CAT_ID), record]));
    return [recordById.get(selectedEvent.primaryCatalogId), recordById.get(selectedEvent.secondaryCatalogId)].filter((record): record is OmmRecord => Boolean(record));
  }, [focusRecords, selectedEvent]);
  const tcaPoints = useMemo(() => {
    if (!selectedEvent || pairRecords.length !== 2) return [];
    return pairRecords.flatMap((record) => propagateOmm(record, new Date(selectedEvent.tca)) ?? []);
  }, [pairRecords, selectedEvent]);
  const cpaPoint = useMemo<ScenePoint | null>(() => {
    if (!selectedEvent || tcaPoints.length !== 2) return null;
    const center = midpoint(tcaPoints[0], tcaPoints[1]);
    return {
      ...center,
      catalogId: -1,
      name: 'TCA closest approach target',
      epoch: selectedEvent.tca,
      color: '#ff4452',
      radius: 0.22,
      role: 'red closest-approach target · public-element approximation',
      selected: true,
      selectable: false,
      markerKind: 'cpa',
    };
  }, [selectedEvent, tcaPoints]);
  const showEncounterGeometry = Boolean(
    selectedEvent
    && (replayPhase === 'encounter' || Math.abs(new Date(selectedEvent.tca).getTime() - simulationTime) < 1_500),
  );
  const tcaScenePoints = useMemo<ScenePoint[]>(() => {
    if (!selectedEvent || !reviewPair || tcaPoints.length !== 2) return [];
    return tcaPoints.map((point) => {
      const protectedObject = point.catalogId === reviewPair.protectedCatalogId;
      return {
        ...point,
        color: protectedObject ? MONITORED_SATELLITE_COLOR : RISK_ORBIT_COLOR,
        radius: 0.17,
        role: `${protectedObject ? 'selected satellite' : 'paired object'} position at TCA · public-element approximation`,
        selected: true,
        selectable: false,
        markerKind: 'tca',
      };
    });
  }, [reviewPair, selectedEvent, tcaPoints]);
  const scenePoints = useMemo(
    () => [
      ...interactivePoints.filter((point) => !threatIds.has(point.catalogId)),
      ...selectedThreatPoints,
      ...(showEncounterGeometry ? tcaScenePoints : []),
      ...(cpaPoint ? [cpaPoint] : []),
    ],
    [cpaPoint, interactivePoints, selectedThreatPoints, showEncounterGeometry, tcaScenePoints, threatIds],
  );
  const pairLabels = useMemo(() => scenePoints.filter((point) => (
    point.markerKind === 'cpa'
    || (!replayActive && selectedIds.includes(point.catalogId))
    || (showFleetLabels && fleetIds.includes(point.catalogId))
  )).map((point) => ({
    ...point,
    label: point.markerKind === 'cpa'
      ? 'TCA · CLOSEST APPROACH'
      : selectedIds.includes(point.catalogId)
      ? point.markerKind === 'debris'
        ? `DEBRIS · ${point.name}`
        : point.catalogId === reviewPair?.protectedCatalogId
          ? `PROTECTED · ${point.name}`
          : `COUNTERPART · ${point.name}`
      : `MONITORED · ${point.name}`,
  })), [fleetIds, replayActive, reviewPair, scenePoints, selectedIds, showFleetLabels]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globeReady || !globe || !replayActive || !selectedEvent || !reviewPair) return;
    const preparedById = new Map(preparedFocusRecords.map(({ prepared }) => [Number(prepared.record.NORAD_CAT_ID), prepared]));
    preparedThreats.forEach((prepared, catalogId) => preparedById.set(catalogId, prepared));
    const protectedRecord = preparedById.get(reviewPair.protectedCatalogId);
    const counterpartRecord = preparedById.get(reviewPair.counterpartCatalogId);
    if (!protectedRecord || !counterpartRecord) return;

    const controls = globe.controls();
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.autoRotate = false;
    let animationFrame = 0;

    const sceneVector = (point: PropagatedObject) => {
      const coordinates = globe.getCoords(point.lat, point.lng, point.altitude);
      return new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z);
    };

    const desiredCamera = (target: THREE.Vector3, outwardDistance: number, eastDistance: number, northDistance: number) => {
      const outward = target.clone().normalize();
      const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward);
      if (east.lengthSq() < 0.001) east.set(1, 0, 0);
      east.normalize();
      const north = new THREE.Vector3().crossVectors(outward, east).normalize();
      return target.clone()
        .add(outward.multiplyScalar(outwardDistance))
        .add(east.multiplyScalar(eastDistance))
        .add(north.multiplyScalar(northDistance));
    };

    const moveMarker = (catalogId: number, position: THREE.Vector3) => {
      markerByCatalogIdRef.current.get(catalogId)?.position.copy(position);
    };

    const tick = () => {
      const replayFrame = replayFrameRef.current;
      if (replayFrame) {
        const date = new Date(replayFrame.simulationTime);
        const protectedPoint = propagatePreparedOmm(protectedRecord, date);
        const counterpartPoint = propagatePreparedOmm(counterpartRecord, date);
        if (protectedPoint && counterpartPoint) {
          const protectedPosition = sceneVector(protectedPoint);
          const counterpartPosition = sceneVector(counterpartPoint);
          moveMarker(reviewPair.protectedCatalogId, protectedPosition);
          moveMarker(reviewPair.counterpartCatalogId, counterpartPosition);

          if (replayFrame.phase === 'follow') {
            globe.camera().position.lerp(desiredCamera(protectedPosition, 46, 18, 10), 0.14);
            controls.target.lerp(protectedPosition, 0.2);
          } else {
            const center = protectedPosition.clone().add(counterpartPosition).multiplyScalar(0.5);
            if (replayFrame.phase === 'acquire') {
              globe.camera().position.lerp(desiredCamera(center, 82, 24, 12), 0.12);
              controls.target.lerp(center, 0.18);
            } else {
              globe.camera().position.lerp(desiredCamera(center, 118, 58, 38), 0.16);
              controls.target.lerp(center, 0.24);
            }
          }
          controls.update();
        }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [globeReady, preparedFocusRecords, preparedThreats, replayActive, replayFrameRef, reviewPair, selectedEvent]);

  const orbitPathMinute = Math.floor(simulationTime / 300_000) * 5;
  const paths = useMemo<OrbitPath[]>(() => {
    const sampledAt = new Date(orbitPathMinute * 60_000);
    const recordById = new Map(focusRecords.map((record) => [Number(record.NORAD_CAT_ID), record]));
    const pairIds = new Set(selectedIds);
    const background = fleetIds.flatMap((catalogId) => {
      if (pairIds.has(catalogId)) return [];
      if (!selectedEvent && catalogId === selectedSatelliteId) return [];
      const record = recordById.get(catalogId);
      if (!record) return [];
      const style = orbitVisualStyle('watchlist');
      return [{ ...sampleOrbitPath(record, sampledAt, style.color, 64), role: 'watchlist' as const, ...style }];
    });
    if (!selectedEvent) {
      if (!selectedSatelliteId) return background;
      const selectedRecord = recordById.get(selectedSatelliteId);
      if (!selectedRecord) return background;
      const selectedStyle = orbitVisualStyle('selected-satellite');
      const selectedColor = fleetIds.includes(selectedSatelliteId)
        ? MONITORED_SATELLITE_COLOR
        : CATALOG_SATELLITE_COLOR;
      return [{
        ...sampleOrbitPath(selectedRecord, sampledAt, selectedColor, 96),
        role: 'selected-satellite' as const,
        ...selectedStyle,
        color: selectedColor,
      }, ...background];
    }

    if (!reviewPair) return background;
    const protectedRecord = recordById.get(reviewPair.protectedCatalogId);
    const counterpartRecord = recordById.get(reviewPair.counterpartCatalogId);
    const selectedStyle = orbitVisualStyle('protected-risk');
    const pairedStyle = orbitVisualStyle('paired-object', RISK_ORBIT_COLOR);
    const tcaTime = new Date(selectedEvent.tca).getTime();
    const startTime = Math.min(trajectoryStartTime ?? simulationTime, tcaTime);
    const durationMinutes = Math.max(1, (tcaTime - startTime) / 60_000);
    const segmentSamples = Math.min(280, Math.max(72, Math.ceil(durationMinutes / 4)));
    const selectedPath = protectedRecord
      ? [{
          ...sampleOrbitSegment(protectedRecord, new Date(startTime), new Date(tcaTime), selectedStyle.color, segmentSamples),
          role: 'protected-risk' as const,
          ...selectedStyle,
        }]
      : [];
    const pairedPath = counterpartRecord
      ? [{
          ...sampleOrbitSegment(counterpartRecord, new Date(startTime), new Date(tcaTime), pairedStyle.color, segmentSamples),
          role: 'paired-object' as const,
          ...pairedStyle,
        }]
      : [];
    const cpaStyle = orbitVisualStyle('cpa-link');
    const cpaPath = showEncounterGeometry && tcaPoints.length === 2 ? [{
      catalogId: -1,
      name: 'Public-element closest approach connector',
      role: 'cpa-link' as const,
      ...cpaStyle,
      points: tcaPoints.map(({ lat, lng, altitude }) => ({ lat, lng, altitude })),
    }] : [];
    const depthPaths = showEncounterGeometry ? tcaPoints.map((point) => {
      const color = RISK_ORBIT_COLOR;
      const style = orbitVisualStyle('depth-guide', color);
      return {
        catalogId: point.catalogId,
        name: `${point.name} altitude depth guide at TCA`,
        role: 'depth-guide' as const,
        ...style,
        points: [
          { lat: point.lat, lng: point.lng, altitude: 0.004 },
          { lat: point.lat, lng: point.lng, altitude: point.altitude },
        ],
      };
    }) : [];
    return [...background, ...selectedPath, ...pairedPath, ...depthPaths, ...cpaPath];
  }, [fleetIds, focusRecords, orbitPathMinute, reviewPair, selectedEvent, selectedIds, selectedSatelliteId, showEncounterGeometry, simulationTime, tcaPoints, trajectoryStartTime]);

  useEffect(() => {
    if (!globeReady || !globeRef.current) return;
    const globe = globeRef.current;
    const controls = globe.controls();
    controls.enableRotate = !replayActive;
    controls.enablePan = !replayActive;
    controls.enableZoom = !replayActive;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.autoRotate = cameraMode === 'global';

    if (replayActive) {
      controls.autoRotate = false;
      return;
    }

    if (cameraMode === 'free') {
      followedTargetRef.current = null;
      positionedCameraKeyRef.current = `free:${cameraResetKey}`;
      return;
    }

    const pairPoints = scenePoints.filter((point) => selectedIds.includes(point.catalogId));
    const protectedPoint = pairPoints.find((point) => point.catalogId === reviewPair?.protectedCatalogId);
    const counterpartPoint = pairPoints.find((point) => point.catalogId === reviewPair?.counterpartCatalogId);
    const pairCoordinates = protectedPoint && counterpartPoint ? [protectedPoint, counterpartPoint].map((point) => {
      const coordinates = globe.getCoords(point.lat, point.lng, point.altitude);
      return new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z);
    }) : [];

    if (cameraMode === 'pair-follow' && selectedEvent && protectedPoint && cpaPoint && !replayActive) {
      controls.autoRotate = false;
      const cameraKey = `approach:${selectedEvent.id}:${cameraResetKey}`;
      if (positionedCameraKeyRef.current !== cameraKey) {
        const center = midpoint(protectedPoint, cpaPoint);
        globe.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.62 }, 520);
        positionedCameraKeyRef.current = cameraKey;
      }
      return;
    }

    if ((cameraMode === 'pair-follow' || replayPhase === 'acquire') && pairCoordinates.length === 2) {
      controls.autoRotate = false;
      const [first, second] = pairCoordinates;
      const angle = first.clone().normalize().angleTo(second.clone().normalize());
      if (angle <= THREE.MathUtils.degToRad(55)) {
        if (replayActive && protectedPoint && counterpartPoint) {
          const center = midpoint(protectedPoint, counterpartPoint);
          globe.pointOfView({ lat: center.lat, lng: center.lng, altitude: 0.92 }, 165);
          positionedCameraKeyRef.current = `pair:${selectedEvent?.id ?? 'selection'}:${cameraResetKey}`;
          return;
        }
        const target = first.clone().add(second).multiplyScalar(0.5);
        const outward = target.clone().normalize();
        const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward);
        if (east.lengthSq() < 0.001) east.set(1, 0, 0);
        east.normalize();
        const separation = first.distanceTo(second);
        const desired = target.clone().add(outward.multiplyScalar(Math.min(170, Math.max(76, 72 + separation * 1.45)))).add(east.multiplyScalar(25));
        globe.camera().position.lerp(desired, replayActive ? 0.16 : 0.32);
        controls.target.lerp(target, replayActive ? 0.22 : 0.45);
        followedTargetRef.current = target;
        controls.update();
        positionedCameraKeyRef.current = `pair:${selectedEvent?.id ?? 'selection'}:${cameraResetKey}`;
        return;
      }
    }

    if ((cameraMode === 'encounter' || replayPhase === 'encounter') && selectedEvent && cpaPoint) {
      controls.autoRotate = false;
      followedTargetRef.current = null;
      const cameraKey = `encounter:${selectedEvent.id}:${cameraResetKey}`;
      if (positionedCameraKeyRef.current === cameraKey) return;
      const targetCoordinates = globe.getCoords(cpaPoint.lat, cpaPoint.lng, cpaPoint.altitude);
      const target = new THREE.Vector3(targetCoordinates.x, targetCoordinates.y, targetCoordinates.z);
      const outward = target.clone().normalize();
      const polarAxis = new THREE.Vector3(0, 1, 0);
      const east = new THREE.Vector3().crossVectors(polarAxis, outward);
      if (east.lengthSq() < 0.001) east.set(1, 0, 0);
      east.normalize();
      const north = new THREE.Vector3().crossVectors(outward, east).normalize();
      const desired = target.clone()
        .add(outward.multiplyScalar(118))
        .add(east.multiplyScalar(58))
        .add(north.multiplyScalar(38));
      if (replayActive) {
        globe.camera().position.lerp(desired, 0.24);
        controls.target.lerp(target, 0.3);
      } else {
        globe.camera().position.copy(desired);
        controls.target.copy(target);
      }
      controls.update();
      if (!replayActive || globe.camera().position.distanceTo(desired) < 0.5) positionedCameraKeyRef.current = cameraKey;
      return;
    }

    const point = interactivePoints.find((item) => item.catalogId === focusCatalogId)
      ?? threatPoints.find((item) => item.catalogId === focusCatalogId);
    if ((cameraMode === 'follow' || replayPhase === 'follow') && point) {
      controls.autoRotate = false;
      if (replayActive) {
        globe.pointOfView({ lat: point.lat, lng: point.lng, altitude: 0.72 }, 165);
        positionedCameraKeyRef.current = `follow:${point.catalogId}:${cameraResetKey}`;
        return;
      }
      const coordinates = globe.getCoords(point.lat, point.lng, point.altitude);
      const target = new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z);
      const cameraKey = `follow:${point.catalogId}:${cameraResetKey}`;
      if (positionedCameraKeyRef.current !== cameraKey) {
        const outward = target.clone().normalize();
        const polarAxis = new THREE.Vector3(0, 1, 0);
        const east = new THREE.Vector3().crossVectors(polarAxis, outward);
        if (east.lengthSq() < 0.001) east.set(1, 0, 0);
        east.normalize();
        const north = new THREE.Vector3().crossVectors(outward, east).normalize();
        globe.camera().position.copy(target.clone()
          .add(outward.multiplyScalar(42))
          .add(east.multiplyScalar(24))
          .add(north.multiplyScalar(15)));
        positionedCameraKeyRef.current = cameraKey;
      } else if (followedTargetRef.current) {
        const movement = target.clone().sub(followedTargetRef.current);
        globe.camera().position.add(movement.multiplyScalar(replayActive ? 0.62 : 0.86));
      }
      controls.target.lerp(target, replayActive ? 0.7 : 0.9);
      followedTargetRef.current = target;
      controls.update();
      return;
    }

    const cameraKey = `global:${cameraResetKey}`;
    if (positionedCameraKeyRef.current === cameraKey) return;
    followedTargetRef.current = null;
    controls.target.set(0, 0, 0);
    controls.autoRotate = true;
    globe.pointOfView({ lat: 18, lng: 78, altitude: 2.15 }, 700);
    positionedCameraKeyRef.current = cameraKey;
  }, [cameraMode, cameraResetKey, cpaPoint, focusCatalogId, globeReady, interactivePoints, replayActive, replayPhase, reviewPair, scenePoints, selectedEvent, selectedIds, threatPoints]);

  return (
    <div className="globe-host" ref={containerRef} data-camera-mode={cameraMode} aria-label="Interactive SGP4-propagated Earth globe">
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        rendererConfig={RENDERER_CONFIG}
        animateIn={false}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/earth-blue-marble.jpg"
        showGraticules
        showAtmosphere
        atmosphereColor="#2f9aca"
        atmosphereAltitude={0.12}
        objectsData={scenePoints}
        objectLat="lat"
        objectLng="lng"
        objectAltitude="altitude"
        objectThreeObject={renderMarker}
        objectLabel={markerLabel}
        onObjectClick={selectMarker}
        labelsData={pairLabels}
        labelLat="lat"
        labelLng="lng"
        labelAltitude={labelAltitude}
        labelText="label"
        labelSize={labelSize}
        labelColor={labelColor}
        labelDotRadius={0}
        labelResolution={2}
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor={pathColor}
        pathStroke={pathStroke}
        pathDashLength={pathDashLength}
        pathDashGap={pathDashGap}
        pathDashAnimateTime={pathDashAnimateTime}
        pathResolution={6}
        pathTransitionDuration={0}
        onGlobeReady={configureGlobe}
      />
      {!globeReady && <div className="globe-loading">Initializing WebGL Earth and SGP4 catalogue…</div>}
      <div className="globe-attribution">Earth imagery: NASA Visible Earth / Blue Marble · Orbit data: CelesTrak · monitored-fleet fallback: SatNOGS DB</div>
    </div>
  );
}
