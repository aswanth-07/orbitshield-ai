export type DataStatus = 'current' | 'cached' | 'unavailable';
export type ScreeningPriority = 'review' | 'watch' | 'low' | 'needs-data';

export type OmmRecord = {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number | string;
  ECCENTRICITY: number | string;
  INCLINATION: number | string;
  RA_OF_ASC_NODE: number | string;
  ARG_OF_PERICENTER: number | string;
  MEAN_ANOMALY: number | string;
  EPHEMERIS_TYPE?: 0 | '0';
  CLASSIFICATION_TYPE?: 'U' | 'C';
  NORAD_CAT_ID: number | string;
  ELEMENT_SET_NO: number | string;
  REV_AT_EPOCH?: number | string;
  BSTAR: number | string;
  MEAN_MOTION_DOT: number | string;
  MEAN_MOTION_DDOT: number | string;
  OBJECT_TYPE?: string;
  COUNTRY_CODE?: string;
  LAUNCH_DATE?: string;
  DECAY_DATE?: string | null;
};

export type PropagatedObject = {
  catalogId: number;
  name: string;
  epoch: string;
  lat: number;
  lng: number;
  altitude: number;
  altitudeKm: number;
};

export type FleetObject = {
  catalogId: number;
  name: string;
  shortName: string;
  mission: string;
};

export type FleetDefinition = {
  id: string;
  name: string;
  description: string;
  objects: FleetObject[];
};

export type ConjunctionRecord = {
  id: string;
  primaryCatalogId: number;
  primaryName: string;
  primaryElementAgeDays: number | null;
  secondaryCatalogId: number;
  secondaryName: string;
  secondaryElementAgeDays: number | null;
  tca: string;
  rangeKm: number | null;
  relativeSpeedKmS: number | null;
  maximumProbability: number | null;
  dilutionKm: number | null;
  priority: ScreeningPriority;
  reasons: string[];
  flags: Array<'close-range' | 'near-tca' | 'stale-elements'>;
};

export type SocratesRun = {
  currentAsOf: string | null;
  start: string | null;
  stop: string | null;
  thresholdKm: number | null;
  primaryCount: number | null;
  secondaryCount: number | null;
  conjunctionCount: number | null;
};

export type CatalogResponse = {
  status: DataStatus;
  source: string;
  upstream?: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  count: number;
  objects: OmmRecord[];
  message?: string;
};

export type ConjunctionResponse = {
  status: DataStatus;
  source: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  run: SocratesRun;
  events: ConjunctionRecord[];
  message?: string;
};

export type EventExplanation = {
  whatIsHappening: string;
  whyPrioritized: string;
  recommendedSteps: string[];
  limitation: string;
  generator: 'deterministic' | 'local-model';
};

export type CdmPoint = {
  time_to_tca: number;
  risk: number | null;
  max_risk_estimate: number | null;
  miss_distance: number | null;
  relative_speed: number | null;
  relative_position_r: number | null;
  relative_position_t: number | null;
  relative_position_n: number | null;
  relative_velocity_r: number | null;
  relative_velocity_t: number | null;
  relative_velocity_n: number | null;
  mission_id: number | null;
  c_object_type: string | null;
  geocentric_latitude: number | null;
  t_position_covariance_det: number | null;
  c_position_covariance_det: number | null;
  t_obs_used: number | null;
  c_obs_used: number | null;
};

export type CdmSequence = {
  source: string;
  sourcePage: string;
  preparedAt: string;
  eventId: number;
  reservedForValidation: boolean;
  cutoffDays: number;
  visibleCdms: CdmPoint[];
  recordedOutcome: CdmPoint;
  fullCdmCount: number;
};

export type OrbitPath = {
  catalogId: number;
  name: string;
  color: string;
  points: Array<{ lat: number; lng: number; altitude: number }>;
};
