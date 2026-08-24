import type { ConjunctionRecord, EventExplanation } from './types';

function probabilityPhrase(event: ConjunctionRecord) {
  if (event.maximumProbability === null) return 'a usable maximum-probability estimate is not available';
  return `the source reports a maximum probability of ${event.maximumProbability.toExponential(2)}`;
}

export function explainConjunction(event: ConjunctionRecord): EventExplanation {
  const range = event.rangeKm === null ? 'an unavailable minimum range' : `approximately ${event.rangeKm.toFixed(2)} kilometres`;
  const tca = new Date(event.tca).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  });
  const topReason = event.reasons[0] ?? 'the source record requires further review';

  const recommendedSteps =
    event.priority === 'review'
      ? ['Request newer tracking or operator CDM data.', 'Escalate the event to a flight-dynamics analyst.', 'Reassess after the next source update.']
      : event.priority === 'watch'
        ? ['Continue monitoring subsequent screening updates.', 'Check whether newer orbit data changes the priority.', 'Escalate if probability rises or uncertainty remains high.']
        : ['Keep the event in the watchlist.', 'Review it again when the source data refreshes.'];

  return {
    whatIsHappening: `${event.primaryName} and ${event.secondaryName} are screened to pass within ${range} at ${tca} UTC.`,
    whyPrioritized: `${topReason} In the same record, ${probabilityPhrase(event)}.`,
    recommendedSteps,
    limitation: 'This is public screening intelligence, not a confirmed collision, operational warning or autonomous manoeuvre instruction.',
    generator: 'deterministic',
  };
}
