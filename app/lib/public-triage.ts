import publicModelFixture from '../data/public-triage-model.json';
import { scoreLiveCdmSequence, type LiveCdmMessage, type LiveCdmModel } from './live-model';
import type { ConjunctionRecord } from './types';

export type PublicTriageModel = LiveCdmModel & {
  maxHorizonDays: number;
  featureLabels: string[];
  dataset: {
    raw_rows: number;
    raw_events: number;
    events_with_t2: number;
    high_risk_events: number;
    trainEvents: number;
    validationEvents: number;
    testEvents: number;
    reservedEventExcluded: boolean;
  };
  crosswalk: Record<string, string>;
  warning: string;
};

export type PublicTriageResult = {
  event: ConjunctionRecord;
  modelId: string;
  score: number;
  threshold: number;
  triage: 'elevated' | 'routine';
  hoursToTca: number;
  inputCoverage: number;
};

export const PUBLIC_TRIAGE_MODEL = publicModelFixture as PublicTriageModel;

export function scorePublicConjunction(
  event: ConjunctionRecord,
  now: number,
  model = PUBLIC_TRIAGE_MODEL,
): PublicTriageResult | null {
  if (
    event.maximumProbability === null || event.maximumProbability <= 0
    || event.rangeKm === null || event.rangeKm < 0
    || event.relativeSpeedKmS === null || event.relativeSpeedKmS < 0
  ) return null;
  const hoursToTca = (new Date(event.tca).getTime() - now) / 3_600_000;
  if (!Number.isFinite(hoursToTca) || hoursToTca <= 0 || hoursToTca > model.maxHorizonDays * 24) return null;
  const message: LiveCdmMessage = {
    time_to_tca: hoursToTca / 24,
    risk: Math.log10(event.maximumProbability),
    miss_distance: event.rangeKm * 1_000,
    relative_speed: event.relativeSpeedKmS * 1_000,
    max_risk_estimate: null,
    c_object_type: null,
  };
  const inference = scoreLiveCdmSequence([message], model);
  return {
    event,
    modelId: model.id,
    score: inference.score,
    threshold: inference.threshold,
    triage: inference.triage,
    hoursToTca,
    inputCoverage: inference.inputCoverage,
  };
}
