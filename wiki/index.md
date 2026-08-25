---
title: OrbitShield Wiki
updated: 2026-08-25
status: active
---

# OrbitShield

OrbitShield is an offline-capable ML conjunction-review prototype
for the Space Technology theme. The current build combines public CelesTrak
screening, a persistent India Earth Observation fleet watch, SGP4 globe
rendering, model-prioritized review alerts, accelerated satellite and debris
encounters, an advisory manoeuvre trade study, and an ESA CDM model pipeline.

## Frozen decisions

- Public OMM and SOCRATES data provide current context, deterministic screening
  and the four fields used by the deployed two-day triage model.
- ESA or operator CDM sequences provide model inputs, uncertainty evidence, and
  held-out validation.
- Event 9051 stays outside every training partition and supplies the judge
  replay.
- The deployed public-feature model raises a named analyst alert only for a
  complete event inside 48 hours whose score crosses its trained threshold.
- Rich operator CDM histories remain the professional model path for covariance
  and sequence-aware inference.
- The primary demonstration stays in one monitoring workspace: fleet, ML alert
  and candidate queues on the left, orbital picture in the centre, and risk
  analysis on the right.
- A manoeuvre preview compares small R-T-N impulses by added separation at the
  source TCA and estimated propellant. It withholds post-manoeuvre probability
  until a covariance-backed CDM and full-catalogue re-screen are available.

## Pages

- `product.md`: judge workflow, customer problem, value, and hackathon scope.
- `architecture.md`: data lanes, model boundaries, interfaces, and offline
  behavior.
- `model-benchmark.md`: literature basis, five trained models, metrics and
  selection policy.
- `real-world-case.md`: current satellite and debris facts, ISRO operations,
  fuel economics, orbit congestion, product pitch, and model explanation.
- `verification.md`: supported runtimes and checks for each change class.
