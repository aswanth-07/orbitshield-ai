import { describe, expect, it } from 'vitest';

import { explainConjunction } from './explanations';
import { enrichConjunction, screeningPriority } from './screening';

const base = {
  primaryCatalogId: 41877,
  primaryName: 'RESOURCESAT-2A',
  primaryElementAgeDays: 2,
  secondaryCatalogId: 270316,
  secondaryName: 'UNKNOWN',
  secondaryElementAgeDays: 6,
  tca: '2026-08-24T12:00:00.000Z',
  rangeKm: 0.8,
  relativeSpeedKmS: 12.3,
  maximumProbability: 1e-4,
  dilutionKm: 0.2,
};

describe('prototype screening policy', () => {
  it('uses the documented probability bands and preserves missing data', () => {
    expect(screeningPriority(1e-4)).toBe('review');
    expect(screeningPriority(1e-6)).toBe('watch');
    expect(screeningPriority(9.99e-7)).toBe('low');
    expect(screeningPriority(null)).toBe('needs-data');
  });

  it('keeps range, time and element age as separate flags', () => {
    const event = enrichConjunction(base, new Date('2026-08-24T00:00:00.000Z'));
    expect(event.flags).toEqual(expect.arrayContaining(['close-range', 'near-tca', 'stale-elements']));
    expect(event.priority).toBe('review');
  });

  it('builds a deterministic explanation without collision or manoeuvre claims', () => {
    const event = enrichConjunction(base, new Date('2026-08-24T00:00:00.000Z'));
    const explanation = explainConjunction(event);
    expect(explanation.generator).toBe('deterministic');
    expect(explanation.whatIsHappening).toContain('0.80 kilometres');
    expect(explanation.limitation).toContain('not a confirmed collision');
    expect(explanation.recommendedSteps.join(' ')).toContain('flight dynamics');
    expect(explanation.recommendedSteps.join(' ')).toContain('mission authority');
    expect(explanation.recommendedSteps.join(' ')).not.toMatch(/perform|execute|burn/i);
  });
});

