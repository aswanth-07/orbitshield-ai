'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type EncounterDepthInsetProps = {
  r: number;
  t: number;
  n: number;
  primaryColor: string;
  secondaryColor: string;
};

type DepthModel = {
  secondary: THREE.Group;
  separation: THREE.Line;
  depthGuide: THREE.Line;
  projectedRing: THREE.Mesh;
  render: () => void;
};

function lineBetween(points: THREE.Vector3[], color: string, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.11, gapSize: 0.07, transparent: true, opacity: 0.82 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function glowingMarker(color: string, radius: number) {
  const marker = new THREE.Group();
  marker.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 18),
    new THREE.MeshBasicMaterial({ color }),
  ));
  marker.add(new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.05, 20, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false }),
  ));
  return marker;
}

function scaledEncounter(r: number, t: number, n: number) {
  const planarMaximum = Math.max(1, Math.abs(r), Math.abs(t));
  const planarScale = 1.72 / planarMaximum;
  const depthMagnitude = Math.abs(n) < 1
    ? 0
    : Math.sign(n) * (0.7 + Math.min(0.5, Math.log10(Math.abs(n) + 1) / 12));
  const primaryPosition = new THREE.Vector3(0, 0.055, 0);
  const secondaryPosition = new THREE.Vector3(r * planarScale, depthMagnitude + 0.055, t * planarScale);
  const planeProjection = new THREE.Vector3(secondaryPosition.x, 0.035, secondaryPosition.z);
  return { primaryPosition, secondaryPosition, planeProjection };
}

function updateDepthModel(model: DepthModel, r: number, t: number, n: number) {
  const { primaryPosition, secondaryPosition, planeProjection } = scaledEncounter(r, t, n);
  model.secondary.position.copy(secondaryPosition);
  model.projectedRing.position.copy(planeProjection);
  model.separation.geometry.setFromPoints([primaryPosition, secondaryPosition]);
  model.depthGuide.geometry.setFromPoints([planeProjection, secondaryPosition]);
  model.depthGuide.computeLineDistances();
  model.render();
}

export default function EncounterDepthInset({ r, t, n, primaryColor, secondaryColor }: EncounterDepthInsetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<DepthModel | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b0d');
    scene.fog = new THREE.Fog('#070b0d', 6.5, 11);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(4.7, 3.55, 5.4);
    camera.lookAt(0, 0.18, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const geometryGroup = new THREE.Group();
    scene.add(geometryGroup);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 4.8),
      new THREE.MeshBasicMaterial({ color: '#17313a', transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.012;
    geometryGroup.add(plane);

    const grid = new THREE.GridHelper(4.8, 10, '#45616b', '#1d3037');
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.58;
    });
    geometryGroup.add(grid);

    geometryGroup.add(
      new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-2.05, 0.025, 0), 4.1, '#56c8e8', 0.18, 0.1),
      new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.025, -2.05), 4.1, '#e3a64a', 0.18, 0.1),
      new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.025, 0), 2.25, '#ac89ff', 0.18, 0.1),
    );

    const { primaryPosition, secondaryPosition, planeProjection } = scaledEncounter(0, 0, 0);

    const primary = glowingMarker(primaryColor, 0.13);
    primary.position.copy(primaryPosition);
    geometryGroup.add(primary);

    const secondary = glowingMarker(secondaryColor, 0.15);
    secondary.position.copy(secondaryPosition);
    geometryGroup.add(secondary);

    const separation = lineBetween([primaryPosition, secondaryPosition], '#f4f7f9');
    const depthGuide = lineBetween([planeProjection, secondaryPosition], secondaryColor, true);
    geometryGroup.add(separation, depthGuide);

    const projectedRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.018, 8, 36),
      new THREE.MeshBasicMaterial({ color: secondaryColor, transparent: true, opacity: 0.72 }),
    );
    projectedRing.position.copy(planeProjection);
    projectedRing.rotation.x = Math.PI / 2;
    geometryGroup.add(projectedRing);

    const render = () => renderer.render(scene, camera);
    const model = { secondary, separation, depthGuide, projectedRing, render };
    modelRef.current = model;
    const resize = () => {
      const width = Math.max(260, host.clientWidth);
      const height = Math.max(170, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      observer.disconnect();
      scene.traverse((object) => {
        if ('geometry' in object && object.geometry instanceof THREE.BufferGeometry) object.geometry.dispose();
        if ('material' in object) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material instanceof THREE.Material && material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      if (modelRef.current === model) modelRef.current = null;
    };
  }, [primaryColor, secondaryColor]);

  useEffect(() => {
    if (modelRef.current) updateDepthModel(modelRef.current, r, t, n);
  }, [n, r, t]);

  return (
    <div
      className="encounter-depth-visual"
      role="img"
      aria-label={`Oblique three-dimensional R T N encounter view. Relative radial ${r.toFixed(0)} metres, in-track ${t.toFixed(0)} metres, normal ${n.toFixed(0)} metres.`}
    >
      <div className="encounter-depth-canvas" ref={hostRef} aria-hidden="true" />
      <div className="depth-axis-label depth-axis-r">R · radial</div>
      <div className="depth-axis-label depth-axis-t">T · in-track</div>
      <div className="depth-axis-label depth-axis-n">N · depth magnified</div>
      <div className="depth-cue"><i style={{ borderColor: secondaryColor }} /> vertical guide = N depth · independent scale</div>
    </div>
  );
}
