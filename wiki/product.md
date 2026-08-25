---
title: OrbitShield Product Direction
updated: 2026-08-25
status: active
---

# Product direction

OrbitShield helps a small satellite operations team monitor its fleet and decide
which conjunction needs human review first. Public screening builds the
candidate queue. The deployed two-day model scores complete current events and
turns only elevated results into analyst alerts with an evidence brief.

## Judge workflow

1. The application opens with automatic source refresh, green public-catalogue
   satellites, six blue monitored satellites and orbits, one primary ML risk
   alert and a separate public candidate queue. A compact current-model card
   identifies the deployed two-day Public Feed HGB model without showing the
   full research benchmark in the judge path.
2. The model rescans complete current events inside 48 hours every minute. A
   named event appears under Live ML Risk Alerts only after its score crosses
   the stored threshold.
3. The right rail gives every public candidate an exact TCA in India Standard
   Time and states that model scoring waits for compatible CDM evidence.
4. Candidate selection frames the final twenty-minute approach. A solid red
   protected path and dashed red counterpart path start at their displayed SGP4
   positions and end at the circled TCA geometry. The red target pulses during
   the replay. Accelerated follow keeps the pair visible while time advances.
5. The right rail gives a brief: the source collision probability, the model
   score and threshold, and the reason human review is required. The model
   score remains separate from the source probability.
6. Clicking the alert starts a 6.5-second globe replay. A chase camera follows
   the protected satellite before it acquires the counterpart and arrives at
   the pulsing red TCA target.
7. The five-model ESA benchmark remains available in the implementation and
   project evidence, but it no longer crowds the live monitoring workspace.

## Customer and value

The first customer profile is a university mission, small satellite operator,
or emerging constellation without a large round-the-clock flight-dynamics
team. OrbitShield reduces repetitive interpretation, standardizes escalation,
and preserves a concise evidence trail for specialist review.

The open tier uses public data for fleet context, transparent candidate
screening and preliminary two-day ML triage. The professional path connects
private CDMs for covariance-aware inference, then adds grounded narration,
notifications and audit history after formal operational validation.

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
public screening queue and two-day model work without a private data
connection. The model uses four shared fields and rejects incomplete, past or
more distant events. Only an elevated model output becomes an alert. The richer
five-model CDM benchmark remains research evidence for the professional tier.
Authentication, autonomous
manoeuvres, broad fleet administration, and operational certification remain
outside this release.
