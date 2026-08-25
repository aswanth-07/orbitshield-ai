export type LiveCdmMessage = Record<string, number | string | null> & {
  time_to_tca: number;
  risk: number | null;
  miss_distance: number | null;
  max_risk_estimate: number | null;
  c_object_type: string | null;
};

type TreeNode = {
  value: number;
  feature: number;
  threshold: number;
  left: number;
  right: number;
  missingLeft: boolean;
  leaf: boolean;
};

export type LiveCdmModel = {
  schemaVersion: 1;
  id: string;
  name: string;
  generatedAt: string;
  source: string;
  artifactSha256: string;
  cutoffDays: number;
  riskThresholdLog10: number;
  scoreThreshold: number;
  baseline: number;
  featureNames: string[];
  medians: number[];
  categoryMap: Record<string, number>;
  trees: TreeNode[][];
  validation: { f2: number; recall: number; precision: number; pr_auc: number };
  test: { f2: number; recall: number; precision: number; pr_auc: number };
};

export type LiveCdmInference = {
  modelId: string;
  score: number;
  threshold: number;
  triage: 'elevated' | 'routine';
  messagesSeen: number;
  inputCoverage: number;
  imputedFeatures: number;
  latestTimeToTca: number;
  latestRisk: number | null;
  latestMissDistance: number | null;
  minimumMissDistance: number | null;
  riskTrendPerDay: number;
};

function numeric(message: LiveCdmMessage, key: string) {
  const value = message[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function valid(values: number[]) {
  return values.filter(Number.isFinite);
}

function mean(values: number[]) {
  const filtered = valid(values);
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : Number.NaN;
}

function standardDeviation(values: number[]) {
  const filtered = valid(values);
  if (filtered.length < 2) return Number.NaN;
  const average = mean(filtered);
  return Math.sqrt(filtered.reduce((sum, value) => sum + (value - average) ** 2, 0) / (filtered.length - 1));
}

function minimum(values: number[]) {
  const filtered = valid(values);
  return filtered.length ? Math.min(...filtered) : Number.NaN;
}

function maximum(values: number[]) {
  const filtered = valid(values);
  return filtered.length ? Math.max(...filtered) : Number.NaN;
}

function riskSlope(messages: LiveCdmMessage[]) {
  const pairs = messages
    .map((message) => [numeric(message, 'time_to_tca'), numeric(message, 'risk')] as const)
    .filter(([time, risk]) => Number.isFinite(time) && Number.isFinite(risk));
  if (pairs.length < 2) return 0;
  const xSum = pairs.reduce((sum, [x]) => sum + x, 0);
  const ySum = pairs.reduce((sum, [, y]) => sum + y, 0);
  const xxSum = pairs.reduce((sum, [x]) => sum + x * x, 0);
  const xySum = pairs.reduce((sum, [x, y]) => sum + x * y, 0);
  const denominator = pairs.length * xxSum - xSum * xSum;
  return Math.abs(denominator) < 1e-12 ? 0 : (pairs.length * xySum - xSum * ySum) / denominator;
}

export function buildLiveCdmFeatures(messages: LiveCdmMessage[], model: LiveCdmModel) {
  if (!messages.length) throw new Error('At least one CDM is required for inference.');
  const ordered = [...messages].sort((a, b) => a.time_to_tca - b.time_to_tca);
  const latest = ordered[0];
  const previous = ordered[1];
  const raw = new Map<string, number>();

  for (const feature of model.featureNames) {
    if (feature.startsWith('latest_') && feature !== 'latest_c_object_type') {
      raw.set(feature, numeric(latest, feature.slice('latest_'.length)));
    } else if (feature.startsWith('delta_')) {
      const key = feature.slice('delta_'.length);
      raw.set(feature, previous ? numeric(latest, key) - numeric(previous, key) : Number.NaN);
    }
  }

  const risks = ordered.map((message) => numeric(message, 'risk'));
  const missDistances = ordered.map((message) => numeric(message, 'miss_distance'));
  const maxRiskEstimates = ordered.map((message) => numeric(message, 'max_risk_estimate'));
  raw.set('visible_cdm_count', ordered.length);
  raw.set('visible_span_days', maximum(ordered.map((message) => message.time_to_tca)) - minimum(ordered.map((message) => message.time_to_tca)));
  raw.set('risk_mean', mean(risks));
  raw.set('risk_std', standardDeviation(risks));
  raw.set('risk_min', minimum(risks));
  raw.set('risk_max', maximum(risks));
  raw.set('risk_range', maximum(risks) - minimum(risks));
  raw.set('risk_slope_per_day', riskSlope(ordered));
  raw.set('miss_distance_min', minimum(missDistances));
  raw.set('max_risk_estimate_max', maximum(maxRiskEstimates));
  raw.set('latest_c_object_type', model.categoryMap[String(latest.c_object_type ?? 'UNKNOWN')] ?? model.categoryMap.UNKNOWN ?? 0);

  for (const name of ['latest_t_position_covariance_det', 'latest_c_position_covariance_det']) {
    const value = raw.get(name) ?? Number.NaN;
    if (Number.isFinite(value)) raw.set(name, Math.log10(Math.max(Math.abs(value), 1e-30)));
  }
  for (const name of model.featureNames.filter((feature) => feature.includes('sigma_'))) {
    const value = raw.get(name) ?? Number.NaN;
    if (Number.isFinite(value)) raw.set(name, Math.sign(value) * Math.log10(1 + Math.abs(value)));
  }
  const latestRisk = raw.get('latest_risk') ?? Number.NaN;
  if (Number.isFinite(latestRisk)) raw.set('latest_risk', Math.min(0, Math.max(-30, latestRisk)));

  let observed = 0;
  const values = model.featureNames.map((name, index) => {
    const value = raw.get(name) ?? Number.NaN;
    if (Number.isFinite(value)) {
      observed += 1;
      return value;
    }
    return model.medians[index];
  });
  return { values, observed, raw };
}

function treeValue(nodes: TreeNode[], features: number[]) {
  let index = 0;
  while (!nodes[index].leaf) {
    const node = nodes[index];
    const value = features[node.feature];
    index = Number.isNaN(value)
      ? (node.missingLeft ? node.left : node.right)
      : (value <= node.threshold ? node.left : node.right);
  }
  return nodes[index].value;
}

export function scoreLiveCdmSequence(messages: LiveCdmMessage[], model: LiveCdmModel): LiveCdmInference {
  const { values, observed, raw } = buildLiveCdmFeatures(messages, model);
  const logOdds = model.baseline + model.trees.reduce((sum, tree) => sum + treeValue(tree, values), 0);
  const score = 1 / (1 + Math.exp(-logOdds));
  const latest = [...messages].sort((a, b) => a.time_to_tca - b.time_to_tca)[0];
  const minimumMissDistance = raw.get('miss_distance_min') ?? Number.NaN;
  return {
    modelId: model.id,
    score,
    threshold: model.scoreThreshold,
    triage: score >= model.scoreThreshold ? 'elevated' : 'routine',
    messagesSeen: messages.length,
    inputCoverage: observed / model.featureNames.length,
    imputedFeatures: model.featureNames.length - observed,
    latestTimeToTca: latest.time_to_tca,
    latestRisk: Number.isFinite(numeric(latest, 'risk')) ? numeric(latest, 'risk') : null,
    latestMissDistance: Number.isFinite(numeric(latest, 'miss_distance')) ? numeric(latest, 'miss_distance') : null,
    minimumMissDistance: Number.isFinite(minimumMissDistance) ? minimumMissDistance : null,
    riskTrendPerDay: raw.get('risk_slope_per_day') ?? 0,
  };
}
