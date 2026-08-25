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
left rail separates model-generated risk alerts from public screening
candidates. The centre keeps the active catalogue, screened debris, monitored
orbits and TCA replay in one WebGL scene. The right rail renders either a
selected object's verified profile, a public candidate review, or the live
model state.

The replay clock writes verified SGP4 states to a shared frame reference. A
WebGL animation loop moves only the selected pair and camera, so the monitoring
rails do not render on every frame. Monitored background objects, screened
debris and the optional full catalogue use separate slower time buckets.
The global simulation clock advances every 100 milliseconds and supplies the
catalogue, monitored fleet and risk-object layers. Explicit 1x, 10x and 60x
controls set that multiplier. Adaptive catalogue buckets cap worker requests at
high speed while the visible fleet follows the accelerated clock.
Prepared SGP4 records and cached Three.js marker geometry avoid repeated parsing
and allocation. The worker allows one catalogue propagation in flight and
retains only the newest queued time, which prevents replay requests from
building a backlog. A red screen-facing target and label mark the computed
public-element midpoint at TCA. Event paths use a bounded final twenty-minute
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
and the SOCRATES values remain authoritative for the event card. These rules
rank screening candidates. They never raise an ML alert or claim that the CDM
model scored fields it did not receive.

## CDM intelligence lane

The Python pipeline groups ESA CDM rows by event, removes information inside
the final two-day interval, engineers temporal and covariance features, and
keeps events separate across train, validation, and test partitions. Event
9051 remains reserved for the judge replay.

Latest-risk persistence is the safety baseline. The benchmark trains Logistic
Regression, Random Forest, Histogram Gradient Boosting, LightGBM and a
Multi-Layer Perceptron on the same event-held-out split. Histogram Gradient
Boosting leads validation F2 at 0.859 and reaches 0.846 test F2. LightGBM reaches
the highest model test PR-AUC at 0.856. The MLP does not improve the benchmark.
The UI identifies input coverage, validation evidence and calibration limits. A
public event stays in an `Awaiting CDM` state until a compatible operator
history is connected.

`POST /api/model/score` is the provider-neutral live inference boundary. It
accepts one event's ordered CDM messages, rejects evidence inside the T-2
cutoff, rebuilds the same 76 engineered features used in training, and executes
the exported 67-tree Histogram Gradient Boosting champion. The TypeScript tree
evaluator matches the Python model after every message in the reserved event
sequence. Responses carry the model identity, input coverage, threshold,
triage score and an explicit non-probability warning.

`GET`, `POST` and `DELETE /api/model/live` provide the real-time ingestion
surface used by the workspace. A provider posts one CDM at a time. The current
worker isolate retains the active event, updates the score after every arrival,
and exposes the latest state without caching. The dashboard polls this state
every 1.5 seconds. `CDM_INGEST_TOKEN` can protect writes when configured. This
in-memory channel supports the local hackathon demonstration; a production
deployment replaces it with durable event storage or a direct provider query.
An external connector may include an absolute `tca` value. The route normalizes
it to ISO time, and every judge-facing absolute timestamp is formatted in India
Standard Time. The ESA archive provides a relative T-minus timeline but no
trustworthy absolute event time, so the test feed states that limit.

The main workspace starts in a listening state. A connected operator feed is
labelled `OPERATOR FEED`. When no external provider is configured, the labelled
ESA validation pair starts automatically and sends the nine visible messages
from held-out event 9051 through the same ingestion route. The route
deduplicates test messages by `time_to_tca`, so reloads preserve one nine-CDM
sequence. The UI labels its anonymized target as ESA Mission 1 and its encounter
object as 9051-C. Public SOCRATES events stay separate and retain `Awaiting CDM`
because their fields cannot satisfy this contract.

Selecting the model alert opens a 6.5-second R–T–N replay. The replay uses the
latest evidence available before the T-2 cutoff: its reported miss vector and
relative velocity define a local linear final twenty-second approach. A red
ring marks the reported 67-metre closest point. The interface uses a logarithmic
distance scale and states that the scene is magnified. It does not place the
anonymized event on the Earth globe.

The accelerated TCA replay uses a fixed twenty-minute window and a 6.5-second
presentation duration. Camera phases follow the protected object, acquire the
pair, and then frame the encounter. At Earth scale the pair is necessarily
nearly coincident, so the final debris view is a labelled magnified schematic
using the authoritative SOCRATES miss range rather than fabricated geometry.

## Offline behavior

Bundled catalogue, monitored-fleet TLE, conjunction, threat, exported model,
and ESA stream fixtures keep the complete judge path available without network
access. Python training artifacts stay outside Git. The committed model export
contains only the selected estimator, preprocessing values, model identity and
source hash needed for deterministic inference.

## Stable contracts

- `DataStatus`: `current`, `cached`, or `unavailable`.
- `ScreeningPriority`: `review`, `watch`, `low`, or `needs-data`.
- Public event metrics retain source timestamps and nullable source fields.
- Public screening candidates and CDM model alerts remain distinguishable in
  every view.
- Only an elevated CDM model score populates the ML risk alert queue.
- Judge-facing absolute timestamps use India Standard Time.
- Model results never overwrite SOCRATES fields or claim operational authority.
- The T-2 cutoff and reserved-event identity travel with every replay result.
- Live model input below the T-2 cutoff is rejected before feature generation.
- External and held-out test feeds remain visibly distinguishable.
