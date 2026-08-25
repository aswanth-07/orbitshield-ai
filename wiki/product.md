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

1. The application opens with automatic source refresh, green public-catalogue
   satellites, six blue monitored satellites and orbits, and a ranked alert
   queue.
2. The judge can select any satellite for a concise verified profile or select
   an alert to inspect. OrbitShield keeps the orbital picture visible for
   context.
3. The right rail explains what is happening, why the alert fired, the verified
   metrics, the model coverage state, and the next review steps.
4. Alert selection frames the final twenty-minute approach. A solid red
   protected path and dashed red counterpart path start at their displayed SGP4
   positions and end at the circled TCA geometry. Accelerated follow keeps the
   pair visible while time advances.
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

## Why a human reviews the alert

Tracking updates change the estimated orbit and its uncertainty. A high model
score therefore identifies an event that deserves scarce analyst time; it does
not settle an operational decision. A qualified mission team can request newer
tracking, obtain operator CDMs, verify covariance and sensitivity, coordinate
with the other spacecraft operator, and run a manoeuvre study under mission
constraints. Mission authority then chooses continued monitoring, coordination
or an approved orbit change. Human approval protects fuel, mission objectives
and the spacecraft's future conjunction environment.

## Business case

Small operators receive large screening queues but may not employ a
round-the-clock conjunction analyst. OrbitShield acts as the triage and evidence
layer between raw alerts and specialist review. The product reduces time spent
reading low-value alerts, gives every escalation the same evidence structure,
and preserves an audit trail for operators, agencies and insurers. A
professional subscription can combine private CDM connectors, fleet watchlists,
validated model scoring, team notifications and review history.

## Hackathon boundary

The hackathon build prioritizes one persistent and explainable workflow. The
public screening alert triggers without a private data connection. The trained
model activates only when a CDM sequence provides its required uncertainty and
covariance fields. Authentication, autonomous manoeuvres, broad fleet
administration, and operational certification remain outside this release.
