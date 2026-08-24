import type { ConjunctionRecord, ScreeningPriority } from './types';

type RawConjunction = Omit<ConjunctionRecord, 'id' | 'priority' | 'reasons' | 'flags'>;

export function screeningPriority(probability: number | null): ScreeningPriority {
  if (probability === null || !Number.isFinite(probability) || probability < 0) return 'needs-data';
  if (probability >= 1e-4) return 'review';
  if (probability >= 1e-6) return 'watch';
  return 'low';
}

export function enrichConjunction(raw: RawConjunction, now = new Date()): ConjunctionRecord {
  const priority = screeningPriority(raw.maximumProbability);
  const reasons: string[] = [];
  const flags: ConjunctionRecord['flags'] = [];
  const hoursToTca = (new Date(raw.tca).getTime() - now.getTime()) / 3_600_000;

  if (priority === 'review') reasons.push('Maximum probability is at or above the prototype review threshold.');
  else if (priority === 'watch') reasons.push('Maximum probability is inside the prototype watch band.');
  else if (priority === 'low') reasons.push('Maximum probability is below the prototype watch threshold.');
  else reasons.push('The source does not contain a usable maximum-probability value.');

  if (raw.rangeKm !== null && raw.rangeKm <= 1) {
    flags.push('close-range');
    reasons.push('The reported minimum range is one kilometre or less.');
  }
  if (hoursToTca >= 0 && hoursToTca <= 24) {
    flags.push('near-tca');
    reasons.push('The event is within 24 hours of closest approach.');
  }
  if (
    (raw.primaryElementAgeDays !== null && raw.primaryElementAgeDays > 5) ||
    (raw.secondaryElementAgeDays !== null && raw.secondaryElementAgeDays > 5)
  ) {
    flags.push('stale-elements');
    reasons.push('At least one screened orbit element is more than five days old at TCA.');
  }

  return {
    ...raw,
    id: `${raw.primaryCatalogId}-${raw.secondaryCatalogId}-${raw.tca}`,
    priority,
    reasons,
    flags,
  };
}

const ORDER: Record<ScreeningPriority, number> = {
  review: 0,
  watch: 1,
  low: 2,
  'needs-data': 3,
};

export function comparePriority(a: ConjunctionRecord, b: ConjunctionRecord) {
  return (
    ORDER[a.priority] - ORDER[b.priority] ||
    (b.maximumProbability ?? -1) - (a.maximumProbability ?? -1) ||
    new Date(a.tca).getTime() - new Date(b.tca).getTime()
  );
}

export function formatProbability(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return value.toExponential(2).replace('e', ' × 10^');
}
