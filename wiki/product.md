---
title: OrbitShield Product Direction
updated: 2026-08-24
status: active
---

# Product direction

OrbitShield helps a small satellite operations team decide which conjunction
needs human review first. The product converts public screening or connected
CDM histories into a short priority queue, an evidence brief, and a controlled
escalation workflow.

## Judge workflow

1. The opening globe shows current orbital context and one primary action for
   the India Earth Observation fleet.
2. Fleet analysis opens the highest screening priority and hides unrelated
   traffic.
3. Accelerated TCA follow keeps the selected satellite and counterpart visible
   while time advances to closest approach.
4. The event brief presents TCA, miss range, relative speed, maximum
   probability, priority reasons, and safe review steps.
5. The AI replay shows a held-out ESA event using only CDMs available at least
   two days before TCA. It compares the latest-risk baseline with model
   evidence, exposes uncertainty, and reveals the recorded outcome on request.

## Customer and value

The first customer profile is a university mission, small satellite operator,
or emerging constellation without a large round-the-clock flight-dynamics
team. OrbitShield reduces repetitive interpretation, standardizes escalation,
and preserves a concise evidence trail for specialist review.

The open tier uses public data for context and transparent screening. A future
professional tier connects private CDMs, model inference, collaboration,
notifications, and audit history after formal operational validation.

## Hackathon boundary

The hackathon build prioritizes one complete and explainable workflow. Search,
large watchlists, advanced camera controls, raw fields, and model diagnostics
remain available through secondary controls. Authentication, autonomous
manoeuvres, and operational certification remain outside this release.
