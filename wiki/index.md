---
title: OrbitShield Wiki
updated: 2026-08-24
status: active
---

# OrbitShield

OrbitShield is an offline-capable orbital-conjunction triage prototype for the
Space Technology theme. The current build combines public CelesTrak screening,
an India Earth Observation fleet workflow, SGP4 globe rendering, focused
satellite and debris encounters, and an ESA CDM training pipeline. The
hackathon release adds a held-out T-2 AI replay as the decision-support proof.

## Frozen decisions

- Public OMM and SOCRATES data provide current context and deterministic
  screening. They do not stand in for operator CDM histories.
- ESA or operator CDM sequences provide model inputs, uncertainty evidence, and
  held-out validation.
- Event 9051 stays outside every training partition and supplies the judge
  replay.
- OrbitShield supports preliminary review and analyst escalation. It does not
  issue operational alerts or manoeuvre instructions.
- The primary demonstration uses the India Earth Observation fleet and one
  focused event instead of a broad dashboard tour.

## Pages

- `product.md`: judge workflow, customer problem, value, and hackathon scope.
- `architecture.md`: data lanes, model boundaries, interfaces, and offline
  behavior.
- `verification.md`: supported runtimes and checks for each change class.
