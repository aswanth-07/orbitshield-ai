---
title: OrbitShield Product Direction
updated: 2026-08-25
status: active
---

# Product direction

OrbitShield helps a small satellite operations team monitor its fleet and decide
which conjunction needs human review first. The product converts public
screening or connected CDM histories into persistent alerts, an evidence brief,
and a controlled escalation workflow.

## Judge workflow

1. The application opens with six monitored satellites, automatic source
   refresh, six solid green orbits, and a ranked alert queue.
2. The judge selects a satellite to follow or an alert to inspect. OrbitShield
   keeps the rest of the orbital picture visible for context.
3. The right rail explains what is happening, why the alert fired, the verified
   metrics, the model coverage state, and the next review steps.
4. Accelerated TCA follow keeps the protected satellite and counterpart visible
   while time advances to closest approach.
5. Inline model evidence compares five trained families and shows the held-out
   ESA validation result without presenting it as the score for a public
   SOCRATES event.

## Customer and value

The first customer profile is a university mission, small satellite operator,
or emerging constellation without a large round-the-clock flight-dynamics
team. OrbitShield reduces repetitive interpretation, standardizes escalation,
and preserves a concise evidence trail for specialist review.

The open tier uses public data for automated monitoring, context and transparent
screening. A future professional tier connects private CDMs, model inference,
grounded language-model narration, notifications and audit history after formal
operational validation.

## Hackathon boundary

The hackathon build prioritizes one persistent and explainable workflow. The
public screening alert triggers without a private data connection. The trained
model activates only when a CDM sequence provides its required uncertainty and
covariance fields. Authentication, autonomous manoeuvres, broad fleet
administration, and operational certification remain outside this release.
