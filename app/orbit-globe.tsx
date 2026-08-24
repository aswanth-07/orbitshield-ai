'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';

import { propagateOmm, sampleOrbitPath } from './lib/orbit';
import type { OmmRecord, OrbitPath, PropagatedObject } from './lib/types';
import PropagationWorker from './workers/propagation.worker.ts?worker';

type OrbitGlobeProps = {
  catalogue: OmmRecord[];
  focusRecords: OmmRecord[];
  fleetIds: number[];
  selectedIds: number[];
  previewId: number | null;
  focusCatalogId: number | null;
  simulationTime: number;
  showCatalogue: boolean;
  onObjectSelect: (catalogId: number) => void;
};

type InteractivePoint = PropagatedObject & { color: string; radius: number; role: string };

function markerObject(point: InteractivePoint) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.96 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(point.radius * 2.4, 12, 12), material);
  group.add(sphere);
  if (point.radius >= 0.29) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(point.radius * 4.6, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: point.color, transparent: true, opacity: 0.58 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  return group;
}

function pointColor(catalogId: number, fleetIds: number[], selectedIds: number[], previewId: number | null) {
  if (selectedIds[0] === catalogId) return '#35d7ff';
  if (selectedIds[1] === catalogId) return '#ffae45';
  if (previewId === catalogId) return '#f1f6fa';
  if (fleetIds.includes(catalogId)) return '#64d6c1';
  return '#9db2c0';
}

export default function OrbitGlobe({
  catalogue,
  focusRecords,
  fleetIds,
  selectedIds,
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
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [cataloguePoints, setCataloguePoints] = useState<PropagatedObject[]>([]);
  const [globeReady, setGlobeReady] = useState(false);

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
    workerRef.current.postMessage({ type: 'propagate', timestamp: simulationTime });
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
      color: '#7c9caf',
      size: 0.34,
      opacity: 0.36,
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

  const interactivePoints = useMemo<InteractivePoint[]>(() => {
    return focusRecords.flatMap((record) => {
      const point = propagateOmm(record, new Date(simulationTime));
      if (!point) return [];
      const color = pointColor(point.catalogId, fleetIds, selectedIds, previewId);
      return [{
        ...point,
        color,
        radius: selectedIds.includes(point.catalogId) ? 0.34 : previewId === point.catalogId ? 0.29 : 0.18,
        role: selectedIds.includes(point.catalogId) ? 'selected conjunction object' : fleetIds.includes(point.catalogId) ? 'fleet watchlist object' : 'search preview',
      }];
    });
  }, [focusRecords, fleetIds, previewId, selectedIds, simulationTime]);

  const orbitPathMinute = Math.floor(simulationTime / 60_000);
  const paths = useMemo<OrbitPath[]>(() => {
    const sampledAt = new Date(orbitPathMinute * 60_000);
    return focusRecords
      .filter((record) => selectedIds.includes(Number(record.NORAD_CAT_ID)))
      .map((record, index) => sampleOrbitPath(record, sampledAt, index === 0 ? '#35d7ff' : '#ffae45', 120));
  }, [focusRecords, orbitPathMinute, selectedIds]);

  useEffect(() => {
    if (!globeReady || !focusCatalogId || !globeRef.current) return;
    const point = interactivePoints.find((item) => item.catalogId === focusCatalogId);
    if (point) globeRef.current.pointOfView({ lat: point.lat, lng: point.lng, altitude: 1.55 }, 850);
  }, [focusCatalogId, globeReady, interactivePoints]);

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
        objectsData={interactivePoints}
        objectLat="lat"
        objectLng="lng"
        objectAltitude="altitude"
        objectThreeObject={(point) => markerObject(point as InteractivePoint)}
        objectLabel={(point) => {
          const item = point as InteractivePoint;
          return `${item.name} · NORAD ${item.catalogId} · ${item.altitudeKm.toFixed(0)} km · ${item.role}`;
        }}
        onObjectClick={(point) => onObjectSelect((point as InteractivePoint).catalogId)}
        pathsData={paths}
        pathPoints="points"
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="altitude"
        pathColor={(path: object) => (path as OrbitPath).color}
        pathStroke={1.1}
        pathDashLength={0.08}
        pathDashGap={0.012}
        pathDashAnimateTime={5200}
        onGlobeReady={configureGlobe}
      />
      {!globeReady && <div className="globe-loading">Initializing WebGL Earth and SGP4 catalogue…</div>}
      <div className="globe-attribution">Earth imagery: NASA Visible Earth / Blue Marble · Orbit data: CelesTrak</div>
    </div>
  );
}
