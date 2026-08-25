---
title: OrbitShield Wiki
updated: 2026-08-25
status: active
---

# OrbitShield

OrbitShield is an offline-capable ML conjunction-risk prototype
for the Space Technology theme. The current build combines public CelesTrak
screening, a persistent India Earth Observation fleet watch, SGP4 globe
rendering, model-generated risk alerts, accelerated satellite and debris encounters,
and an ESA CDM model pipeline.

## Frozen decisions

- Public OMM and SOCRATES data provide current context and deterministic
  screening. They do not stand in for operator CDM histories.
- ESA or operator CDM sequences provide model inputs, uncertainty evidence, and
  held-out validation.
- Event 9051 stays outside every training partition and supplies the judge
  replay.
- Public screening rows remain candidates. OrbitShield raises an analyst alert
  only when a compatible CDM sequence crosses the trained model threshold.
- The primary demonstration stays in one monitoring workspace: fleet, ML alert
  and candidate queues on the left, orbital picture in the centre, and risk
  analysis on the right.

## Pages

- `product.md`: judge workflow, customer problem, value, and hackathon scope.
- `architecture.md`: data lanes, model boundaries, interfaces, and offline
  behavior.
- `model-benchmark.md`: literature basis, five trained models, metrics and
  selection policy.
- `real-world-case.md`: current satellite and debris facts, ISRO operations,
  fuel economics, orbit congestion, product pitch, and model explanation.
- `verification.md`: supported runtimes and checks for each change class.
