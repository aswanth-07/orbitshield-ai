---
title: OrbitShield Product Direction
updated: 2026-08-25
status: active
---

# Product direction

OrbitShield helps a small satellite operations team monitor its fleet and decide
which conjunction needs human review first. Public screening builds the
candidate queue. The trained model scores connected CDM histories and turns
only elevated results into analyst alerts with an evidence brief.

## Judge workflow

1. The application opens with automatic source refresh, green public-catalogue
   satellites, six blue monitored satellites and orbits, a model alert slot,
   and a separate public candidate queue.
2. The judge can select any satellite for a concise verified profile or select
   a screening candidate to inspect. OrbitShield keeps the orbital picture
   visible for context.
3. The right rail gives every public candidate an exact TCA in India Standard
   Time and states that model scoring waits for compatible CDM evidence.
4. Candidate selection frames the final twenty-minute approach. A solid red
   protected path and dashed red counterpart path start at their displayed SGP4
   positions and end at the circled TCA geometry. Accelerated follow keeps the
   pair visible while time advances.
5. The real-time CDM card explains the message format and listens for an
   operator feed. The labelled ESA validation pair starts automatically and
   sends nine held-out messages through the same ingestion contract. The score
   updates after each arrival and exposes feature coverage.
6. When the trained score crosses its threshold, the left rail receives an ML
   risk alert for ESA Mission 1. Clicking it starts a magnified R–T–N replay of
   the CDM-reported final twenty-second approach to its 67-metre closest point.
7. The 1x, 10x and 60x controls drive the simulation timestamp and every global
   orbital layer. A connected feed can supply the absolute TCA for display in
   IST.

## Customer and value

The first customer profile is a university mission, small satellite operator,
or emerging constellation without a large round-the-clock flight-dynamics
team. OrbitShield reduces repetitive interpretation, standardizes escalation,
and preserves a concise evidence trail for specialist review.

The open tier uses public data for fleet context and transparent candidate
screening. The professional path connects private CDMs to the implemented
inference boundary, then adds grounded narration, notifications and audit
history after formal operational validation.

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

Small operators receive large candidate queues but may not employ a
round-the-clock conjunction analyst. OrbitShield acts as the triage and evidence
layer between raw screening and specialist review. The product reduces time spent
reading low-value candidates, gives every escalation the same evidence structure,
and preserves an audit trail for operators, agencies and insurers. A
professional subscription can combine private CDM connectors, fleet watchlists,
validated model scoring, team notifications and review history.

## Hackathon boundary

The hackathon build prioritizes one persistent and explainable workflow. The
public screening queue works without a private data connection. The trained
model runs end to end on a source-labelled held-out CDM stream and the same
live endpoint accepts compatible operator messages one at a time. Only an
elevated model output becomes an alert. No anonymous
operational CDM provider is configured in the hackathon build, so the interface
labels the ESA source as a test feed. Public events remain gated when
uncertainty and covariance fields are absent. Authentication, autonomous
manoeuvres, broad fleet administration, and operational certification remain
outside this release.
