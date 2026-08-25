---
title: OrbitShield AI Real-World Case
updated: 2026-08-25
status: active
---

# OrbitShield AI: the real-world case

OrbitShield turns a continuous stream of orbital warnings into a short,
explainable action queue. A small mission team sees where its satellites are,
which close approaches deserve attention, how the risk is changing, and what
evidence a flight-dynamics specialist should review next.

The product sells decision time. Raw catalogues already contain thousands of
satellites and debris objects. Operators need a reliable way to find the few
events that could consume fuel, interrupt a mission, delay a launch, or destroy
an asset.

> **One-minute pitch:** About 19,000 satellites remain in Earth orbit, including
> roughly 2,800 to 2,900 dead satellites. Surveillance networks regularly track
> about 46,000 space objects, while models estimate 1.2 million debris objects
> between 1 cm and 10 cm. ISRO analysed more than 150,000 close-approach alerts
> in 2025 and performed 18 Earth-orbit collision avoidance manoeuvres.
> OrbitShield compresses that alert flood into a ranked, visual, evidence-backed
> workflow for teams that cannot staff a national-scale control room.

Data on this page was checked on 25 August 2026. The latest global statistics
were updated on 31 July 2026, CelesTrak's catalogue summary was current on
23 August 2026, and the latest published ISRO assessment covers operations
through 31 December 2025. Counts change every day as objects launch, fail,
fragment, manoeuvre, and re-enter.

## The four numbers a judge should remember

| Real-world fact | Current reference | Why OrbitShield matters |
|---|---:|---|
| Satellites still in Earth orbit | About **18,840** | Every active and inactive payload contributes to the screening problem. |
| Functioning satellites | About **16,000** | Operators must protect a rapidly growing working fleet. |
| Dead satellites still in orbit | About **2,840** by subtraction; CelesTrak independently lists **2,909** | A dead satellite cannot coordinate or move out of the way. |
| Regularly tracked space objects | About **46,420** | A human cannot continuously reason over the full catalogue without automated triage. |

ESA also estimates **54,000 objects larger than 10 cm**, **1.2 million debris
objects from 1 cm to 10 cm**, and **140 million from 1 mm to 1 cm**. Many of
these objects are too small for continuous individual tracking. The counts and
definitions come from [ESA's Space Environment Statistics](https://sdup.esoc.esa.int/discosweb/statistics/).
CelesTrak's fresher public summary lists 16,814 active and 2,909 dead satellites
under its own status rules, which demonstrates why every displayed count needs
a source and timestamp ([CelesTrak SATCAT](https://www.celestrak.org/satcat/)).

A comparable, up-to-the-day LEO-only dead-satellite total requires a catalogue
derivation. OrbitShield can calculate it by selecting payloads whose full orbit
remains below 2,000 km and whose operational status is inactive. The interface
should show the rule, source epoch, and treatment of unknown-status payloads
beside the result.

## Why this problem feels urgent now

A close approach is a forecasting problem at extreme speed. Most LEO
conjunctions have relative speeds near **10 km/s**, according to
[NASA's collision-risk guidance](https://www.nasa.gov/cara/step-2-close-approach-risk-assessment/).
A 1 cm object can cause catastrophic damage, yet most centimetre-scale debris
cannot be followed as a named dot on a public globe.

The risk also compounds. ESA's long-term simulations show that the debris
population can keep growing through collisions even if launches stop. Its 2026
report projects that business-as-usual activity can push the long-term risk
index to about four times the first sustainability target
([ESA Space Environment Report 2026](https://www.sdo.esoc.esa.int/publications/Space_Environment_Report_I10R0_20260501.pdf)).

OrbitShield makes three invisible facts visible:

1. A satellite's displayed position comes from a dated observation and a
   propagated orbit, so source freshness matters.
2. A predicted encounter has uncertainty, so a close nominal path marks one
   possible close approach.
3. A manoeuvre changes future encounters, so the team must screen the new path
   before committing.

## Earth's orbital highways

Altitude classes, orbit shapes, and inclinations overlap. A Sun-synchronous
orbit is usually also a polar LEO, while a transfer orbit can cross several
altitude regimes. The following table uses the practical mission categories
described by [ESA's orbit guide](https://www.esa.int/Enabling_Support/Space_Transportation/Types_of_orbits).

| Orbit | Approximate altitude or geometry | Common uses | Traffic and collision character |
|---|---|---|---|
| Very low Earth orbit (VLEO) | Roughly 180 to 450 km, within LEO | Crewed stations, short-lived imaging, technology missions | Busy in places, with atmospheric drag causing faster orbital change and natural re-entry. |
| Low Earth orbit (LEO) | About 180 to 2,000 km | Earth observation, broadband, science, crewed flight | The densest operational region. Satellites circle Earth in roughly 90 to 130 minutes and cross many other orbital planes. |
| Polar orbit | High inclination, usually LEO | Global mapping, reconnaissance, weather | Crosses near both poles and intersects many differently inclined paths. |
| Sun-synchronous orbit (SSO) | Usually 600 to 800 km with near-polar inclination | Repeatable-lighting Earth imagery, including many Indian EO missions | A narrow, valuable corridor with active spacecraft and persistent legacy debris. |
| Medium Earth orbit (MEO) | 2,000 km to below GEO | GPS, Galileo, GLONASS, BeiDou navigation | Fewer objects than LEO, with high-value constellations and debris that can remain for a long time. |
| Geosynchronous orbit | Orbital period equal to one sidereal day | Communications, weather, regional coverage | Spacecraft return to the same sky position daily but may trace a north-south or east-west pattern. |
| Geostationary orbit (GEO) | Circular, equatorial, 35,786 km altitude | Fixed television, communications, and weather coverage | A thin and valuable ring. Longitude slots and radio interference make operational spacing important. |
| Highly elliptical orbit (HEO), including Molniya and Tundra | Low perigee and high apogee | Long dwell over high latitudes, communications, science | Crosses multiple altitude bands and changes speed sharply along the orbit. |
| Geostationary transfer orbit (GTO) | Ellipse from low altitude to GEO altitude | Temporary route for GEO spacecraft | Crosses LEO and higher regimes until orbit raising finishes. |
| Graveyard or disposal orbit | Commonly above the protected GEO belt | End-of-life storage for GEO satellites | Reduces interference with the active belt but leaves a long-lived inactive object in space. |
| Lagrange-point and deep-space trajectories | Earth-Moon or Sun-Earth dynamical regions | Aditya-L1, astronomy, lunar and planetary missions | Require shared ephemerides and mission-to-mission coordination because Earth-orbit catalogues provide limited coverage. |

### The most densely populated zones

- **The 500 to 600 km LEO shells hold the largest active concentration.** ISRO
  reported 9,396 Starlink satellites still in orbit at the end of 2025. ESA
  found that, around 550 km, hazardous debris and active satellites had reached
  the same order of magnitude
  ([ISRO ISSAR 2025](https://www.isro.gov.in/Indian_Space_Situational_Awareness_Report_2025.html),
  [ESA Space Environment Report 2025](https://www.esa.int/Space_Safety/Space_Debris/ESA_Space_Environment_Report_2025)).
- **The 600 to 800 km Sun-synchronous corridor carries dense Earth-observation
  traffic.** These inclinations give global coverage, so many missions share a
  narrow family of useful paths.
- **The 800 to 1,000 km region contains persistent debris.** Atmospheric drag
  removes objects slowly at these altitudes, allowing fragments and retired
  spacecraft to remain for decades or centuries.
- **The roughly 1,200 km LEO shell hosts large polar constellations such as
  OneWeb.** Its high altitude provides less natural cleanup than the lower
  Starlink shells.
- **GEO is crowded in a different way.** Its total three-dimensional density is
  lower than LEO, but active spacecraft compete for a thin equatorial ring and
  specific longitude slots.

This is why a global object count alone is a weak risk measure. OrbitShield
adds altitude, inclination, crossing geometry, object status, relative speed,
and uncertainty to the picture.

## How collision detection works today, in plain language

Current spaceflight safety resembles air-traffic forecasting with imperfect
radar coverage and vehicles travelling around Earth every ninety minutes.

1. Ground radars, telescopes, and operators estimate each object's orbit.
2. A screening service propagates those orbits forward and finds pairs that
   enter a predefined safety volume.
3. The service sends a Conjunction Data Message (CDM) or alert containing time
   of closest approach, miss distance, relative speed, and uncertainty data.
4. The satellite operator combines that alert with its more accurate private
   ephemeris and covariance, then watches how the estimate changes as new
   tracking arrives.
5. Flight-dynamics specialists study collision probability, mission impact,
   fuel, communication opportunities, and coordination with the other operator.
6. Mission authority approves continued monitoring, coordination, or a
   collision avoidance manoeuvre. The team screens the planned post-manoeuvre
   path for secondary encounters before execution.

NASA explains that a screening hit only means two objects enter the same broad
volume. Collision probability comes from the predicted miss, object sizes, and
uncertainty distributions
([NASA CARA](https://www.nasa.gov/cara/step-2-close-approach-risk-assessment/)).
The uncertainty is commonly represented as a three-dimensional covariance
ellipsoid, then projected into the encounter geometry for a probability of
collision calculation
([Spaceflight Safety Handbook](https://www.nasa.gov/wp-content/uploads/2020/03/spaceflight_safety_handbook_for_operators_v1.5_aug201.pdf)).

### ISRO's current system

ISRO System for Safe and Sustainable Space Operations Management, or IS4OM,
coordinates national space-situational-awareness work. It receives global
warnings, refines them with operational flight-dynamics data, conducts Space
Object Proximity Analysis for satellites, performs Collision Avoidance Analysis
for launches, and coordinates manoeuvres. NETRA expands India's own radar and
optical tracking capacity
([IS4OM](https://www.isro.gov.in/IS4OM.html)).

The 2025 operational funnel makes the workload concrete:

- ISRO analysed **more than 150,000 CSpOC alerts** for its Earth-orbiting
  satellites.
- It performed **14 LEO and 4 GEO collision avoidance manoeuvres**.
- It revised **82 other LEO manoeuvre plans** after checking for close
  approaches on the proposed new paths.
- A Collision Avoidance Analysis recommendation delayed the LVM3-M6 launch by
  **41 seconds**, selecting a safer moment inside the launch window.

These figures come from [ISRO's ISSAR 2025](https://www.isro.gov.in/Indian_Space_Situational_Awareness_Report_2025.html).
They describe a triage funnel. New tracking can reduce risk, some
collision-avoidance needs can be folded into routine orbit maintenance, and a
small number of events progress to dedicated manoeuvres.

### Strengths and remaining operator pain

| Current institutional strength | Remaining pain for a small team |
|---|---|
| Global CSpOC screening covers a large catalogue. | The alert volume overwhelms teams without continuous analyst coverage. |
| Private operator ephemerides improve the protected satellite's state. | Public users often see older, lower-precision elements and incomplete covariance. |
| Human mission authority controls every burn. | Risk histories, mission constraints, and coordination live across several specialist tools. |
| Candidate manoeuvres receive post-manoeuvre screening. | Each candidate can create secondary encounters and requires repeated analysis. |
| NETRA grows India's independent tracking capability. | Radar and optical coverage, ownership data, and international coordination remain fragmented. |

ESA is investing in its CREAM automation programme specifically to reduce
operator workload, false alerts, and response time, which validates the market
need for automated decision support
([ESA CREAM](https://www.esa.int/Space_Safety/Space_Debris/CREAM_avoiding_collisions_in_space_through_automation)).

## Where OrbitShield is better for its first customer

OrbitShield complements national and operator systems. Its advantage lies in
accessibility, prioritisation, and explanation for a university mission,
emerging constellation, or small satellite company.

| User need | Conventional experience | OrbitShield experience |
|---|---|---|
| Understand the fleet now | Separate catalogue, alert, orbit, and mission tools | One workspace keeps the fleet, alert queue, globe, and evidence together. |
| Find the important event | Analysts inspect a large message stream | Transparent Review, Watch, Low, and Needs data states rank the monitored fleet continuously. |
| Explain an alert | CDM fields require specialist interpretation | Plain-language reasons sit beside miss distance, relative speed, probability, source time, and model coverage. |
| Watch risk evolve | Teams compare repeated messages manually | A CDM history becomes a time series with a visible T-minus-two-day decision boundary. |
| Operate through weak connectivity | Live tools can lose context when feeds fail | Timestamped bundled snapshots preserve the judge workflow and label cached data. |
| Prove model discipline | A score can appear without its training boundary | OrbitShield shows the held-out event, cutoff, model version, metrics, and calibration status beside the result. |

ISRO has higher-authority tracking and flight-dynamics data. OrbitShield gives
smaller teams a usable front door to the same decision pattern. A production
deployment becomes stronger when an operator connects private CDMs,
high-accuracy ephemerides, mission constraints, and approved notification
channels.

## Satellite fuel is mission lifetime

Spacecraft carry **propellant**, and the amount ranges from zero to tonnes.
Mission designers budget velocity change, called delta-v, because propulsion
efficiency determines how much useful velocity change each kilogram provides.

| Spacecraft example | Propellant scale | What it illustrates |
|---|---:|---|
| Propulsionless CubeSat | **0 kg** | Many small missions accept no manoeuvre capability and depend on natural decay. |
| CubeSat cold-gas module example | **50 g** of butane in a 300 g module | Even grams can provide useful attitude or small-orbit control on a nanosatellite ([NASA SmallSat propulsion survey](https://ntrs.nasa.gov/api/citations/20160010571/downloads/20160010571.pdf)). |
| Large imaging-satellite operational reserve | Roughly **90 to 405 kg** in a NASA order-of-magnitude study | Larger LEO missions may retain substantial propellant for station keeping and operational manoeuvres ([NASA debris-remediation cost study](https://ntrs.nasa.gov/api/citations/20230002817/downloads/2023%20-%20OTPS%20-%20Cost%20and%20Benefit%20Analysis%20of%20Orbital%20Debris%20Remediation%20-%2020230308v2.pdf?attachment=true)). |
| ISRO GSAT-8 | **1,667 kg** difference between 3,093 kg launch mass and 1,426 kg dry mass | A GEO communications satellite can launch with more than half its mass allocated to orbit raising and lifetime propulsion ([ISRO GSAT-8](https://www.isro.gov.in/GSAT_8.html)). |

Propellant supports several jobs across a mission:

- raising and circularising the orbit after launch;
- maintaining altitude, inclination, longitude, and constellation spacing;
- unloading reaction-wheel momentum and controlling attitude when other
  actuators cannot do the job;
- compensating for atmospheric drag in LEO;
- avoiding a credible conjunction;
- rendezvous, formation flying, and relocation; and
- controlled deorbit or transfer to a disposal orbit at end of life.

Every avoidance burn also spends staff time and can pause instruments. ESA
reports an average of three to four avoidance manoeuvres per mission per year
for its missions in busy orbital highways, with costs in fuel, analysis hours,
and missed science
([ESA, The cost of avoiding collision](https://www.esa.int/ESA_Multimedia/Images/2021/02/The_cost_of_avoiding_collision)).

## How early prediction saves fuel and mission time

An early warning creates planning leverage. As a simple intuition, a velocity
change of only 1 cm/s accumulates to about 1.7 km of straight-line separation
over 48 hours. Real orbital manoeuvre design uses full dynamics, but the example
shows why a small burn made with sufficient lead time can create meaningful
separation by TCA.

The team still needs a sensible commit time. Tracking uncertainty often shrinks
as the encounter approaches, and many alerts fall below concern after new
observations. OrbitShield supports early planning while the risk trend matures,
then gives the specialist current evidence at the decision deadline. This
reduces rushed burns, repeated replanning, unnecessary instrument downtime, and
fuel spent on events that later resolve.

The same idea helps launch vehicles. A rocket intersects many orbital shells on
the way up. Collision Avoidance Analysis marks unsafe seconds inside a launch
window, and the launch team selects a clear time. ISRO's 41-second LVM3-M6
delay in 2025 is an unusually clear example: better prediction changed the
clock and preserved the mission design.

## Choosing the lowest-risk path after a small change

A safe manoeuvre optimiser must evaluate more than the first threatening
object. OrbitShield's production roadmap can turn one proposed burn into a
ranked set of analyst candidates:

1. Generate small along-track, radial, and cross-track changes within the
   spacecraft's thrust, fuel, communication, and payload constraints.
2. Propagate each candidate through and beyond the original TCA.
3. Screen each new path against the full catalogue and connected operator
   ephemerides.
4. Score residual collision risk, delta-v, secondary conjunctions, lost mission
   time, ground-track error, and disposal impact.
5. Present the trade-off frontier to flight dynamics and mission authority for
   approval.

Example: candidate A clears the original debris with a 2 cm/s burn but creates
a new Watch event eighteen hours later. Candidate B uses 1.2 cm/s, clears both
events, and stays inside the Earth-observation ground-track tolerance.
OrbitShield should surface candidate B with the assumptions and sensitivity
visible. Qualified mission personnel still verify and command the manoeuvre.

The hackathon prototype currently stops at alert triage, evidence, and analyst
next steps. Candidate manoeuvre generation, post-manoeuvre catalogue screening,
and command integration belong to the validated production roadmap.

## Space debris: roughly a decade ago and today

| Measure | Roughly a decade ago | Current reference | Change and caveat |
|---|---:|---:|---|
| Catalogued Earth-orbit objects | **17,063** on 30 September 2015 | About **46,420** on 31 July 2026 | About 2.7 times as many. Sensor and catalogue improvements contribute alongside real traffic and debris growth. |
| Modelled objects larger than 1 cm | About **750,000** in 2017 | About **1.2 million** | About 60% higher, using ESA estimates from different model epochs. |
| Active mega-constellation traffic | Pre-Starlink orbital environment | 9,396 Starlink satellites still in orbit by the end of 2025 | Active satellites now dominate several narrow LEO shells. |

Historical sources are NASA's
[October 2015 Orbital Debris Quarterly News](https://www.orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv19i4.pdf)
and ESA's
[2017 debris conference summary](https://www.esa.int/Space_Safety/Space_Debris/European_conference_on_space_debris_risks_and_mitigation).
Current figures use ESA's 2026 statistics and ISRO's 2025 assessment.

The customer impact is larger than the count increase suggests. Constellations
concentrate active satellites into shared shells, more active spacecraft can
manoeuvre without a universal right-of-way system, and improved sensors create
more warnings for operators to process. One fragmentation can add thousands of
new trackable pieces and many smaller untracked ones.

## What the models actually do

OrbitShield uses a hybrid system. Orbital mechanics handles motion and
geometry. Machine learning helps decide which CDM histories deserve earlier
human attention.

### 1. Nominal path: SGP4 propagation

The live globe propagates each public OMM or TLE with SGP4. This produces a
deterministic best-estimate path from the latest public element set. SGP4 is a
physics-based propagator rather than a learned model. The path is only as
current and accurate as its source record.

The display can move a satellite smoothly every frame, while the underlying
orbit record updates on the source's schedule. OrbitShield therefore provides
real-time visual propagation and source-dependent, near-real-time situational
awareness. Operational real-time risk requires direct operator ephemerides,
CDMs, covariance, and higher-frequency tracking feeds.

### 2. Public screening: transparent rules

SOCRATES supplies public conjunction metrics. OrbitShield maps available
maximum probability into Review, Watch, or Low and preserves Needs data when a
usable value is absent. The rule is deterministic and auditable. Public events
remain separate from CDM model inference.

### 3. Early-risk triage: five supervised classifiers

The trained pipeline uses the
[ESA Collision Avoidance Challenge archive](https://kelvins.esa.int/collision-avoidance-challenge/data/).
It creates 76 features from CDMs available at least two days before TCA,
including the latest values, recent changes, time-series summaries, miss
geometry, uncertainty sigmas, and covariance summaries. Events stay intact
across training, validation, and test partitions, and event 9051 remains
reserved for the judge replay.

| Model | Role in the benchmark | Key result |
|---|---|---:|
| Logistic Regression | Simple linear reference | Test F2 0.650 |
| Random Forest | Nonlinear bagged trees | Test F2 0.801 |
| Histogram Gradient Boosting | Selected champion by validation F2 | Validation F2 0.859; test F2 0.846 |
| LightGBM | Efficient boosted-tree comparison | Best test PR-AUC 0.856 |
| Multi-Layer Perceptron | Neural-network comparison | Test F2 0.545 |

F2 gives recall more weight than precision because missing a rare high-risk
event costs more than asking an analyst to inspect one extra case. Latest-risk
persistence remains a strong baseline with test F2 0.842 and recall 0.958. The
small gap between the champion and the baseline keeps the claim grounded: the
prototype demonstrates a leakage-safe triage pipeline and measured evidence,
rather than a certified leap in collision prediction. Full results live in the
[five-model benchmark](model-benchmark.md).

### Is this a P10, P50, P90 quantile model?

The current model is **a high-risk classifier**, so its raw output is a ranking
score. Treat it as triage priority. Operational probability of collision, Pc,
remains a separate physics-derived quantity. Calibration of the score into Pc
remains production work.

P10, P50, and P90 work well for a single forecasted value:

- P50 is the median forecast.
- P10 and P90 bound the middle 80% of forecast outcomes.
- A wide P10-to-P90 interval tells the user that the forecast remains
  uncertain.

A satellite path needs more structure than three scalar quantiles. Position
error has three dimensions, velocity error, time dependence, and correlated
directions. Operational systems therefore use covariance ellipsoids or Monte
Carlo state samples. OrbitShield can later show P10, P50, and P90 for a scalar
such as miss distance or predicted final log-risk, while retaining the full
covariance for collision geometry.

Example: a median miss distance of 300 m sounds comfortable. If the uncertainty
envelope still includes 20 m at P10, the event deserves review. If even the P10
miss remains several kilometres away and the covariance is tight and realistic,
the team can consider de-escalation.

NASA's recent AI/ML review found limited evidence for replacing operational
conjunction risk assessment with learned methods. That result
supports OrbitShield's product boundary: physics computes and validates risk,
while AI ranks histories, detects patterns, explains evidence, and reduces
analyst workload
([NASA CARA AI/ML Compendium](https://ntrs.nasa.gov/citations/20250002065)).

## What OrbitShield can claim today

| Available in the hackathon prototype | Production connection or validation step |
|---|---|
| Current public CelesTrak context with labelled cached fallback | Direct operator ephemerides and authenticated high-frequency feeds |
| SGP4-propagated live 3D satellite and debris view | High-fidelity propagation selected for each operational mission |
| Automatic India EO fleet watch and ranked public alerts | Configurable customer fleets, notification policy, and on-call escalation |
| SOCRATES miss range, speed, probability, TCA, and source time | Operator CDMs with covariance realism and sensitivity checks |
| Plain-language reasons and analyst next steps | Approved operating procedures and auditable team decisions |
| Five-model held-out ESA benchmark and replay | Mission-specific retraining, probability calibration, drift monitoring, and formal validation |
| Accelerated final twenty-minute TCA visualisation | Candidate manoeuvre optimisation and post-manoeuvre full-catalogue screening |

OrbitShield currently supports preliminary decision review. Qualified mission
personnel retain operational authority.

## Demo-ready proof points

- **Roughly 15% of satellites still in orbit are dead.** The 2,800 to 2,900
  inactive spacecraft cannot coordinate a safe crossing.
- **The visible catalogue is the tip of the debris problem.** Networks track
  about 46,000 objects, while models estimate 1.2 million debris objects from
  1 cm to 10 cm.
- **The product addresses a 150,000-alert funnel.** ISRO's 2025 figures show why
  ranking, explanation, and evidence history matter as much as orbital display.
- **A safer launch path can mean a safer launch second.** ISRO avoided a
  predicted launch conjunction by delaying LVM3-M6 by 41 seconds.
- **A manoeuvre can solve one problem and create another.** ISRO revised 82 LEO
  manoeuvre plans after screening their future paths in 2025.
- **Fuel preserved becomes mission life preserved.** Earlier planning allows a
  small velocity change to accumulate separation while protecting science time
  and end-of-life disposal reserve.
- **The future path is an uncertainty tube.** OrbitShield combines a nominal
  physics path, source freshness, covariance-aware evidence, and learned triage
  so the user sees uncertainty around the nominal line.
- **Small operators need an integrated workflow.** OrbitShield puts the fleet,
  alert, geometry, explanation, model coverage, and next review step in one
  place.

## Product position

OrbitShield is the triage and evidence layer between space-surveillance data
and mission authority. Public data gives every team an immediate monitoring
view. Private CDMs and operator ephemerides unlock stronger uncertainty-aware
analysis. A future manoeuvre module can rank safe options under fuel and mission
constraints, while flight dynamics and mission authority control execution.

That position gives the hackathon project a credible path from a visual demo to
a useful safety product: open access first, professional data connections next,
and operational validation before command authority.
