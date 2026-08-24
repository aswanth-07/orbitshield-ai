---
title: OrbitShield Architecture
updated: 2026-08-24
status: active
---

# Architecture

## Web application

The application runs on Next.js 16 through Vinext with React 19 and TypeScript.
Three.js and react-globe.gl render the Earth and encounter layers. satellite.js
propagates OMM records in a worker so catalogue updates do not block the UI.

`app/lib/types.ts` defines the shared contracts for catalogue status,
conjunctions, threats, explanations, CDM sequences, and orbit paths. API routes
under `app/api` expose bootstrap, catalogue, conjunction, threat, and live-data
responses. Each response labels its data as current, cached, or unavailable.

## Public screening lane

CelesTrak OMM records provide orbital elements for SGP4 context. SOCRATES
records provide the displayed public conjunction metrics. Transparent rules
assign Review, Watch, Low, or Needs data. Public geometry remains approximate,
and the SOCRATES values remain authoritative for the event card.

## CDM intelligence lane

The Python pipeline groups ESA CDM rows by event, removes information inside
the final two-day interval, engineers temporal and covariance features, and
keeps events separate across train, validation, and test partitions. Event
9051 remains reserved for the judge replay.

Latest-risk persistence is the safety baseline. The current LightGBM model
provides a secondary high-risk triage signal. A neural challenger was not
adopted because it did not improve held-out validation. The UI identifies the
model version, cutoff, input coverage, baseline, raw score, calibration limit,
grouped evidence, and recorded outcome.

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
- Model results never overwrite SOCRATES fields or claim operational authority.
- The T-2 cutoff and reserved-event identity travel with every replay result.
