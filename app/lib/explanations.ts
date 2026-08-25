import type { ConjunctionRecord, EventExplanation } from './types';
import { formatIst } from './time';

function probabilityPhrase(event: ConjunctionRecord) {
  if (event.maximumProbability === null) return 'a usable maximum-probability estimate is not available';
  return `the source reports a maximum probability of ${event.maximumProbability.toExponential(2)}`;
}

export function explainConjunction(event: ConjunctionRecord): EventExplanation {
  const range = event.rangeKm === null ? 'an unavailable minimum range' : `approximately ${event.rangeKm.toFixed(2)} kilometres`;
  const tca = formatIst(event.tca, { seconds: true, year: true });
  const topReason = event.reasons[0] ?? 'the source record requires further review';

  const recommendedSteps =
    event.priority === 'review'
      ? ['Request newer tracking and operator CDM data.', 'Ask flight dynamics to verify covariance, sensitivity and mission constraints.', 'Let mission authority choose monitoring, operator coordination or a manoeuvre study.']
      : event.priority === 'watch'
        ? ['Continue monitoring subsequent screening updates.', 'Check whether newer orbit data changes the uncertainty or priority.', 'Escalate to flight dynamics if risk rises or uncertainty remains high.']
        : ['Keep the event in the watchlist.', 'Review it again when the source data refreshes.'];

  return {
    whatIsHappening: `${event.primaryName} and ${event.secondaryName} are screened to pass within ${range} at ${tca}.`,
    whyPrioritized: `${topReason} In the same record, ${probabilityPhrase(event)}.`,
    recommendedSteps,
    limitation: 'This is public screening intelligence, not a confirmed collision, operational warning or autonomous manoeuvre instruction.',
    generator: 'deterministic',
  };
}
