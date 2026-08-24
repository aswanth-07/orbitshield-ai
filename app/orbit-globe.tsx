'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';

import {
  objectMarkerColor,
  orbitVisualStyle,
  SATELLITE_COLOR,
} from './lib/collision-visualization';
import { propagateOmm, sampleOrbitPath } from './lib/orbit';
import type { ConjunctionRecord, OmmRecord, OrbitPath, PropagatedObject, ThreatObject } from './lib/types';
import PropagationWorker from './workers/propagation.worker.ts?worker';

type OrbitGlobeProps = {
  catalogue: OmmRecord[];
  focusRecords: OmmRecord[];
  threats: ThreatObject[];
  fleetIds: number[];
  selectedEvent: ConjunctionRecord | null;
  selectedSatelliteId: number | null;
  previewId: number | null;
  focusCatalogId: number | null;
  simulationTime: number;
  showCatalogue: boolean;
  onObjectSelect: (catalogId: number) => void;
};

type ScenePoint = PropagatedObject & {
  color: string;
  radius: number;
  role: string;
  selected: boolean;
  selectable: boolean;
  markerKind: 'satellite' | 'debris' | 'cpa';
  threat?: ThreatObject;
};

function markerObject(point: ScenePoint) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.96 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(point.radius * 2.4, 14, 14), material);
  group.add(sphere);
  if (point.markerKind === 'cpa') {
    const crosshair = new THREE.Mesh(
      new THREE.TorusGeometry(point.radius * 4.8, 0.055, 8, 32),
      new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.88 }),
    );
    crosshair.rotation.x = Math.PI / 2;
    group.add(crosshair);
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
  previewId,
  focusCatalogId,
  simulationTime,
  showCatalogue,
  onObjectSelect,
}: OrbitGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const workerRef = useRef<Worker | null>(null);
  const cloudRef = useRef<THREE.Points | null>(null);
  const onObjectSelectRef = useRef(onObjectSelect);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [cataloguePoints, setCataloguePoints] = useState<PropagatedObject[]>([]);
  const [globeReady, setGlobeReady] = useState(false);

  useEffect(() => {
    onObjectSelectRef.current = onObjectSelect;
  }, [onObjectSelect]);

  const configureGlobe = useCallback(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 115;
    controls.maxDistance = 460;
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
      if (event.data.type === 'points') setCataloguePoints(event.data.points);
    };
    worker.postMessage({ type: 'propagate', timestamp: Date.now() });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [catalogue]);

  useEffect(() => {
    if (!workerRef.current || !showCatalogue) return;
    const timer = window.setTimeout(() => {
      workerRef.current?.postMessage({ type: 'propagate', timestamp: simulationTime });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [simulationTime, showCatalogue]);

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
      color: SATELLITE_COLOR,
      size: 0.42,
      opacity: 0.52,
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

  const interactivePoints = useMemo<ScenePoint[]>(() => {
    return focusRecords.flatMap((record) => {
      const point = propagateOmm(record, new Date(simulationTime));
      if (!point) return [];
      const selected = selectedIds.includes(point.catalogId) || selectedSatelliteId === point.catalogId;
      return [{
        ...point,
        color: SATELLITE_COLOR,
        radius: selected ? 0.34 : previewId === point.catalogId ? 0.28 : 0.19,
        role: selectedIds.includes(point.catalogId) ? 'selected conjunction satellite' : fleetIds.includes(point.catalogId) ? 'active watchlist satellite' : 'satellite search preview',
        selected,
        selectable: true,
        markerKind: 'satellite' as const,
      }];
    });
  }, [focusRecords, fleetIds, previewId, selectedIds, selectedSatelliteId, simulationTime]);

  const threatPoints = useMemo<ScenePoint[]>(() => threats.flatMap((threat) => {
    if (!threat.record) return [];
    const point = propagateOmm(threat.record, new Date(simulationTime));
    if (!point) return [];
    const selected = selectedIds.includes(threat.catalogId) || selectedSatelliteId === threat.catalogId;
    const satellite = threat.objectType === 'PAY' || threat.objectType === 'PAYLOAD';
    return [{
      ...point,
      color: objectMarkerColor(threat.objectType, threat.size),
      radius: (satellite ? 0.2 : threat.size === 'large' ? 0.33 : threat.size === 'medium' ? 0.27 : 0.21) + (selected ? 0.12 : 0),
      role: satellite ? 'satellite conjunction object' : `${threat.size} ${threat.objectType === 'R/B' ? 'rocket body' : 'debris risk object'}`,
      selected,
      selectable: true,
      markerKind: satellite ? 'satellite' as const : 'debris' as const,
      threat,
    }];
  }), [selectedIds, selectedSatelliteId, simulationTime, threats]);

  const threatIds = useMemo(() => new Set(threatPoints.map((point) => point.catalogId)), [threatPoints]);
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
      name: 'Closest approach',
      epoch: selectedEvent.tca,
      color: '#f4f7f9',
      radius: 0.18,
      role: 'closest approach point · public-element approximation',
      selected: true,
      selectable: false,
      markerKind: 'cpa',
    };
  }, [selectedEvent, tcaPoints]);
  const scenePoints = useMemo(
    () => [
      ...interactivePoints.filter((point) => !threatIds.has(point.catalogId)),
      ...threatPoints,
      ...(cpaPoint ? [cpaPoint] : []),
    ],
    [cpaPoint, interactivePoints, threatIds, threatPoints],
  );

  const orbitPathMinute = selectedEvent
    ? Math.floor(new Date(selectedEvent.tca).getTime() / 60_000)
    : Math.floor(simulationTime / 300_000) * 5;
  const paths = useMemo<OrbitPath[]>(() => {
    const sampledAt = new Date(orbitPathMinute * 60_000);
    const recordById = new Map(focusRecords.map((record) => [Number(record.NORAD_CAT_ID), record]));
    const pairIds = new Set(selectedIds);
    const background = fleetIds.flatMap((catalogId) => {
      if (pairIds.has(catalogId)) return [];
      const record = recordById.get(catalogId);
      if (!record) return [];
      const style = orbitVisualStyle('watchlist');
      return [{ ...sampleOrbitPath(record, sampledAt, style.color, 96), role: 'watchlist' as const, ...style }];
    });
    if (!selectedEvent) return background;

    const protectedCatalogId = selectedSatelliteId && pairIds.has(selectedSatelliteId)
      ? selectedSatelliteId
      : selectedEvent.primaryCatalogId;
    const counterpartCatalogId = protectedCatalogId === selectedEvent.primaryCatalogId
      ? selectedEvent.secondaryCatalogId
      : selectedEvent.primaryCatalogId;
    const protectedRecord = recordById.get(protectedCatalogId);
    const counterpartRecord = recordById.get(counterpartCatalogId);
    const counterpartThreat = threats.find((threat) => threat.catalogId === counterpartCatalogId);
    const counterpartColor = objectMarkerColor(counterpartThreat?.objectType ?? counterpartRecord?.OBJECT_TYPE, counterpartThreat?.size);
    const selectedStyle = orbitVisualStyle('selected-satellite');
    const pairedStyle = orbitVisualStyle('paired-object', counterpartColor);
    const selectedPath = protectedRecord
      ? [{ ...sampleOrbitPath(protectedRecord, sampledAt, selectedStyle.color, 140), role: 'selected-satellite' as const, ...selectedStyle }]
      : [];
    const pairedPath = counterpartRecord
      ? [{ ...sampleOrbitPath(counterpartRecord, sampledAt, pairedStyle.color, 140), role: 'paired-object' as const, ...pairedStyle }]
      : [];
    const cpaStyle = orbitVisualStyle('cpa-link');
    const cpaPath = tcaPoints.length === 2 ? [{
      catalogId: -1,
      name: 'Public-element closest approach connector',
      role: 'cpa-link' as const,
      ...cpaStyle,
      points: tcaPoints.map(({ lat, lng, altitude }) => ({ lat, lng, altitude })),
    }] : [];
    return [...background, ...selectedPath, ...pairedPath, ...cpaPath];
  }, [fleetIds, focusRecords, orbitPathMinute, selectedEvent, selectedIds, selectedSatelliteId, tcaPoints, threats]);

  useEffect(() => {
    if (!globeReady || !focusCatalogId || !globeRef.current) return;
    if (selectedEvent && cpaPoint) {
      globeRef.current.pointOfView({ lat: cpaPoint.lat, lng: cpaPoint.lng, altitude: 1.42 }, 850);
      return;
    }
    const point = interactivePoints.find((item) => item.catalogId === focusCatalogId)
      ?? threatPoints.find((item) => item.catalogId === focusCatalogId);
    if (point) globeRef.current.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.55 }, 850);
  }, [cpaPoint, focusCatalogId, globeReady, interactivePoints, selectedEvent, threatPoints]);

  return (
    <div className="globe-host" ref={containerRef} aria-label="Interactive SGP4-propagated Earth globe">
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
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
        objectThreeObject={(point) => markerObject(point as ScenePoint)}
        objectLabel={(point) => {
          const item = point as ScenePoint;
          if (!item.selectable) return `${item.name} · ${item.role}`;
          return `${item.name} · NORAD ${item.catalogId} · ${item.altitudeKm.toFixed(0)} km · ${item.role}${item.threat ? ` · ${item.threat.eventCount} risk event${item.threat.eventCount === 1 ? '' : 's'}` : ''}`;
        }}
        onObjectClick={(point) => {
          const item = point as ScenePoint;
          if (item.selectable) onObjectSelect(item.catalogId);
        }}
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor={(path: object) => (path as OrbitPath).color}
        pathStroke={(path: object) => (path as OrbitPath).stroke ?? 0.5}
        pathDashLength={(path: object) => (path as OrbitPath).dashLength ?? 1}
        pathDashGap={(path: object) => (path as OrbitPath).dashGap ?? 0}
        pathDashAnimateTime={(path: object) => (path as OrbitPath).dashAnimateTime ?? 0}
        onGlobeReady={configureGlobe}
      />
      {!globeReady && <div className="globe-loading">Initializing WebGL Earth and SGP4 catalogue…</div>}
      <div className="globe-attribution">Earth imagery: NASA Visible Earth / Blue Marble · Orbit data: CelesTrak</div>
    </div>
  );
}
