---
title: OrbitShield Architecture
updated: 2026-08-25
status: active
---

# Architecture

## Web application

The application runs on Next.js 16 through Vinext with React 19 and TypeScript.
Three.js and react-globe.gl render the Earth and encounter layers. satellite.js
propagates OMM and TLE records in a worker so catalogue updates do not block the
UI.
Prepared SGP4 records avoid reparsing orbital elements for every path sample or
catalogue refresh. The layout preloads the bundled Earth texture so the globe
does not wait for a second network discovery step.

`app/lib/types.ts` defines the shared contracts for catalogue status,
conjunctions, threats, explanations, CDM sequences, and orbit paths. API routes
under `app/api` expose bootstrap, catalogue, conjunction, threat, and live-data
responses. Each response labels its data as current, cached, or unavailable.

`app/operations-workspace.tsx` owns the persistent three-part product view. The
left rail separates live two-day model alerts from public screening candidates.
The centre keeps the active catalogue, screened debris, monitored
orbits and TCA replay in one WebGL scene. The right rail renders either a
selected object's verified profile, a public candidate review, or the live
model state.

The globe stage includes one compact card for the deployed public-feature
model. It shows the model name, tree count, live-input count and score threshold.
The full ESA five-model comparison remains committed as research evidence but
does not appear in the default judge workspace.

The replay clock writes verified SGP4 states to a shared frame reference. A
WebGL animation loop moves only the selected pair and camera, so the monitoring
rails do not render on every frame. Monitored background objects, screened
debris and the optional full catalogue use separate slower time buckets.
The live simulation clock advances every 100 milliseconds and supplies the
catalogue, monitored fleet and risk-object layers. Accelerated time appears
only inside the bounded TCA replay.
Prepared SGP4 records and cached Three.js marker geometry avoid repeated parsing
and allocation. The worker allows one catalogue propagation in flight and
retains only the newest queued time, which prevents replay requests from
building a backlog. During follow, the camera uses the protected satellite's
propagated forward direction to hold a visible chase position. A red screen-facing target and label mark the computed
public-element midpoint at TCA. The target pulses during accelerated follow.
Selecting a live ML alert loads missing public orbit records and starts the
replay when both records are ready. Event paths use a bounded final twenty-minute
window so repeated Earth-fixed ground tracks do not obscure the encounter. The
protected path is solid red and the counterpart path is dashed red. Their first
and last samples equal the displayed start time and TCA time.

## Public screening lane

CelesTrak OMM records provide orbital elements for SGP4 context. A small
timestamped SatNOGS DB fixture supplies fresher public TLE fallback records for
five monitored objects and identifies Space-Track.org as its element source.
The remaining monitored object retains the normal catalogue fallback when that
feed has no current TLE. SOCRATES records provide the displayed public
conjunction metrics. Transparent rules
assign Review, Watch, Low, or Needs data. Public geometry remains approximate,
and the SOCRATES values remain authoritative for the event card.

The deployed public-feature model accepts events inside 48 hours. It maps TCA,
maximum probability, minimum range and relative speed to the same four numeric
features used during training. A 37-tree Histogram Gradient Boosting classifier
raises an alert when its score crosses 0.67. It reaches 0.631 test F2, 0.933
test recall and 0.529 test PR-AUC on an event-held-out split. The score ranks
analyst review and does not replace the source probability.

Elevated events are ranked first by the source maximum collision probability,
then by model score and time to TCA. The left rail exposes only the primary
alert and reports how many elevated events remain queued. Repeated raw scores
are possible when events land in the same gradient-boosting leaves, so the
alert card displays the source probability while the selected-event view shows
the raw model score and threshold once.

## CDM intelligence lane

The Python pipeline groups ESA CDM rows by event, removes information inside
the final two-day interval, engineers temporal and covariance features, and
keeps events separate across train, validation, and test partitions. Event
9051 remains reserved for regression tests outside the current judge path.

Latest-risk persistence is the safety baseline. The benchmark trains Logistic
Regression, Random Forest, Histogram Gradient Boosting, LightGBM and a
Multi-Layer Perceptron on the same event-held-out split. Histogram Gradient
Boosting leads validation F2 at 0.859 and reaches 0.846 test F2. LightGBM reaches
the highest model test PR-AUC at 0.856. The MLP does not improve the benchmark.
The five-model benchmark remains evidence for the future professional tier. The
current UI exposes the deployed public-feature model's input coverage,
event-held-out metrics and calibration limit.

`POST /api/model/score` is the provider-neutral live inference boundary. It
accepts one event's ordered CDM messages, rejects evidence inside the T-2
cutoff, rebuilds the same 76 engineered features used in training, and executes
the exported 67-tree Histogram Gradient Boosting champion. The TypeScript tree
evaluator matches the Python model after every message in the reserved event
sequence. Responses carry the model identity, input coverage, threshold,
triage score and an explicit non-probability warning.

`GET`, `POST` and `DELETE /api/model/live` provide an experimental CDM ingestion
surface for the professional tier. A provider can post one CDM at a time. The
current worker isolate retains the active event and updates its score after
every arrival. `CDM_INGEST_TOKEN` can protect writes when configured. A
production deployment replaces it with durable event storage or a direct
provider query.
An external connector may include an absolute `tca` value. The route normalizes
it to ISO time, and every judge-facing absolute timestamp is formatted in India
Standard Time. The ESA archive provides a relative T-minus timeline but no
trustworthy absolute event time, so the test feed states that limit.

The CDM endpoint remains available for future operator connectors and model
research. The judge-facing workspace does not start a historical or anonymized
replay. Its alerts come from named events in the current public feed.

The accelerated TCA replay uses a fixed twenty-minute window and a 6.5-second
presentation duration. Camera phases follow the protected object, acquire the
pair, and then frame the encounter. At Earth scale the pair is necessarily
nearly coincident, so the final debris view is a labelled magnified schematic
using the authoritative SOCRATES miss range rather than fabricated geometry.

## Offline behavior

Bundled catalogue, monitored-fleet TLE, conjunction, threat and public-model
fixtures keep the complete judge path available without network
access. Python training artifacts stay outside Git. The committed model export
contains only the selected estimator, preprocessing values, model identity and
source hash needed for deterministic inference.

## Stable contracts

- `DataStatus`: `current`, `cached`, or `unavailable`.
- `ScreeningPriority`: `review`, `watch`, `low`, or `needs-data`.
- Public event metrics retain source timestamps and nullable source fields.
- Public screening candidates and elevated two-day model alerts remain
  distinguishable in every view.
- Only a complete event inside 48 hours can populate the live ML alert queue.
- Judge-facing absolute timestamps use India Standard Time.
- Model results never overwrite SOCRATES fields or claim operational authority.
- The T-2 cutoff and reserved-event identity travel with every replay result.
- Live model input below the T-2 cutoff is rejected before feature generation.
- External and held-out test feeds remain visibly distinguishable.
