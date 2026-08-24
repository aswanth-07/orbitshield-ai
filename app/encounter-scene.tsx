'use client';

import type { CdmPoint } from './lib/types';

export default function EncounterScene({ point }: { point: CdmPoint }) {
  const r = point.relative_position_r ?? 0;
  const t = point.relative_position_t ?? 0;
  const n = point.relative_position_n ?? 0;
  const maximum = Math.max(1, Math.abs(r), Math.abs(t), Math.abs(n));
  const x = 50 + (t / maximum) * 31;
  const y = 50 - (r / maximum) * 31;

  return (
    <div className="encounter-scene" aria-label="Magnified radial, transverse and normal encounter frame">
      <div className="scene-grid" />
      <div className="axis axis-r"><span>+R radial</span></div>
      <div className="axis axis-t"><span>+T along-track</span></div>
      <div className="normal-axis">N {n >= 0 ? '+' : '−'}{Math.abs(n).toFixed(0)} m</div>
      <div className="target-object"><i /><span>Protected object</span></div>
      <div className="secondary-object" style={{ left: `${x}%`, top: `${y}%` }}><i /><span>Secondary object</span></div>
      <div className="relative-vector" style={{ width: `${Math.min(43, Math.hypot(x - 50, y - 50))}%`, transform: `rotate(${Math.atan2(y - 50, x - 50) * 180 / Math.PI}deg)` }} />
      <div className="scene-readout">
        <span>RTN relative position</span>
        <strong>{r.toFixed(1)} / {t.toFixed(1)} / {n.toFixed(1)} m</strong>
      </div>
      <div className="magnified-label">Magnified analytical view · not Earth scale</div>
    </div>
  );
}

