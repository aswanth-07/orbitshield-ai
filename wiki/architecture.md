---
title: OrbitShield Architecture
updated: 2026-08-25
status: active
---

# Architecture

## Web application

The application runs on Next.js 16 through Vinext with React 19 and TypeScript.
Three.js and react-globe.gl render the Earth and encounter layers. satellite.js
propagates OMM records in a worker so catalogue updates do not block the UI.
Prepared SGP4 records avoid reparsing orbital elements for every path sample or
catalogue refresh. The layout preloads the bundled Earth texture so the globe
does not wait for a second network discovery step.

`app/lib/types.ts` defines the shared contracts for catalogue status,
conjunctions, threats, explanations, CDM sequences, and orbit paths. API routes
under `app/api` expose bootstrap, catalogue, conjunction, threat, and live-data
responses. Each response labels its data as current, cached, or unavailable.

`app/operations-workspace.tsx` owns the persistent three-part product view. The
left rail derives monitored-satellite state and the automatic alert queue. The
centre keeps the active catalogue, screened debris, monitored orbits and TCA
replay in one WebGL scene. The right rail renders the grounded alert explanation,
verified metrics, model coverage and analyst workflow.

The replay clock writes verified SGP4 states to a shared frame reference. A
WebGL animation loop moves only the selected pair and camera, so the monitoring
rails do not render on every frame. Monitored background objects, screened
debris and the optional full catalogue use separate slower time buckets.
Prepared SGP4 records and cached Three.js marker geometry avoid repeated parsing
and allocation. The worker allows one catalogue propagation in flight and
retains only the newest queued time, which prevents replay requests from
building a backlog. A red screen-facing target and label mark the computed
closest-approach midpoint at TCA.

## Public screening lane

CelesTrak OMM records provide orbital elements for SGP4 context. SOCRATES
records provide the displayed public conjunction metrics. Transparent rules
assign Review, Watch, Low, or Needs data. Public geometry remains approximate,
and the SOCRATES values remain authoritative for the event card. These rules
raise the live close-approach alerts. They do not claim that the CDM model scored
fields it did not receive.

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

The accelerated TCA replay uses a fixed twenty-minute window and a 6.5-second
presentation duration. Camera phases follow the protected object, acquire the
pair, and then frame the encounter. At Earth scale the pair is necessarily
nearly coincident, so the final debris view is a labelled magnified schematic
using the authoritative SOCRATES miss range rather than fabricated geometry.

## Offline behavior

Bundled catalogue, conjunction, threat, and ESA fixtures keep the complete
judge path available without network access. Generated model artifacts stay
outside Git. A small, source-labelled inference fixture may be committed when
it records a real model run against the reserved event.

## Stable contracts

- `DataStatus`: `current`, `cached`, or `unavailable`.
- `ScreeningPriority`: `review`, `watch`, `low`, or `needs-data`.
- Public event metrics retain source timestamps and nullable source fields.
- Public screening alerts and CDM model scores remain distinguishable in every
  view.
- Model results never overwrite SOCRATES fields or claim operational authority.
- The T-2 cutoff and reserved-event identity travel with every replay result.
