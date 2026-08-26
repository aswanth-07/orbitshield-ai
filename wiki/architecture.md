---
title: OrbitShield Architecture
updated: 2026-08-26
status: active
---

# Architecture

## Web application

The application runs on Next.js 16 through Vinext with React 19 and TypeScript.
Three.js and react-globe.gl render the Earth and encounter layers. satellite.js
propagates OMM and TLE records in a worker so catalogue updates do not block the
UI.
Prepared SGP4 records avoid reparsing orbital elements for every path sample or
catalogue refresh. The layout preloads the bundled Earth texture so the globe
does not wait for a second network discovery step.

`app/lib/types.ts` defines the shared contracts for catalogue status,
conjunctions, threats, explanations, CDM sequences, and orbit paths. API routes
under `app/api` expose bootstrap, catalogue, conjunction, threat, and live-data
responses. Each response labels its data as current, cached, or unavailable.

`app/operations-workspace.tsx` owns the persistent three-part product view. The
left rail separates live two-day model alerts from public screening candidates.
The centre keeps the active catalogue, screened debris, monitored
orbits and TCA replay in one WebGL scene. The right rail renders either a
selected object's verified profile, a public candidate review, or the live
model state.

The monitoring rail has one vertical scrollbar. Fleet controls, the primary
model alert, the mission focus and eight public screening candidates therefore
remain in one predictable reading order instead of trapping the candidate queue
inside a short nested scroller. A compact source strip reports the current,
synchronized or latest-available run and lets the operator request a refresh.

The right rail shows one compact Current Model section only after event
selection. The full ESA five-model comparison remains committed as research
evidence but does not appear in the default judge workspace.

The replay clock writes verified SGP4 states to a shared frame reference. A
WebGL animation loop moves only the selected pair and camera, so the monitoring
rails do not render on every frame. Monitored background objects, screened
debris and the optional full catalogue use separate slower time buckets.
Every monitored label includes a blue anchor dot at its propagated position so
the satellite remains distinguishable from its orbit path at globe scale.
The live simulation clock advances every 500 milliseconds and supplies the
catalogue, monitored fleet and risk-object layers. Accelerated time appears
only inside the bounded TCA replay.
Prepared SGP4 records and cached Three.js marker geometry avoid repeated parsing
and allocation. The worker allows one catalogue propagation in flight and
retains only the newest queued time, which prevents replay requests from
building a backlog. During follow, the camera uses the protected satellite's
propagated forward direction to hold a visible chase position. A red screen-facing target and label mark the computed
public-element midpoint at TCA. The target pulses during accelerated follow.
Selecting an alert requests the current two-object catalogue record even when
the broad catalogue already contains both objects. The broad offline snapshot
can be months older than a selected event, so the workspace compares epochs,
keeps the newest record for each object, and waits for that merge before it
starts the replay. The browser caps this refresh at 2.5 seconds, then falls
back to the newest bundled element set. Event paths use a bounded final twenty-minute window so repeated
Earth-fixed ground tracks do not obscure the encounter. The protected path is
solid red and the counterpart path is dashed red. Their first and last samples
equal the displayed start time and TCA time.

A rough distance scale sits at the bottom left of the globe. `scaleBarForView`
converts the camera height, the vertical field of view and the viewport height
into kilometres per pixel, then picks the roundest step that fills a readable
bar. It is measured across the middle of the view at the Earth surface and is
labelled approx, because anything nearer the limb sits further from the camera
than the bar implies. The bar redraws from an OrbitControls change listener
writing straight to the DOM, so zooming never triggers a React render.

Selecting a satellite opens its profile and leaves the camera where it is. Only
Track, the replay and an event selection move the camera, because an
unrequested jump reads as though a different object swung into view.

Three depth cues make altitude and orientation readable without adding assets
or per-frame work. `app/lib/globe-depth.ts` holds the pure parts.

Droplines join every monitored satellite to its sub-satellite point in one
`LineSegments` buffer, so the whole layer is a single draw call. The layer is
skipped during TCA replay, because the replay rewrites scene points on every
animation frame and the camera is locked to the pair by then.

A directional light placed at the subsolar point lights the globe, which gives a
real day and night terminator from the low-precision NOAA solar position. This
needs no night texture and no custom shader, so it adds no download and no
per-frame cost. The light moves only when the background time bucket advances.

Three back-faced translucent spheres mark the 550 km mega-constellation shell,
the 600 to 800 km Sun-synchronous corridor and the 1,200 km polar shell, each
with an equator ring. They are built once per globe and never touch the
animation loop.

The globe samples stable background orbit paths on a five-minute time bucket.
The TCA replay moves only the selected markers and camera on each animation
frame. This keeps SGP4 path generation out of the high-frequency render loop.
The protected marker grows and turns red during event review, while the replay
camera keeps it near the centre before acquiring the counterpart.

`app/lib/maneuver.ts` builds advisory manoeuvre candidates. It applies a small
impulsive delta-v in the local R-T-N frame and propagates relative displacement
with the linearized Hill-Clohessy-Wiltshire equations. The engine tests 48, 36,
and 24 hour epochs when the event has enough lead time. It ranks only candidates
that meet the configured added-separation goal at the original source TCA, then
chooses the lowest delta-v. The rocket equation estimates propellant and thrust
time from an explicitly editable example spacecraft profile.

`leadTimeCostCurve` prices the same separation goal at 48, 36, 24, 18, 12, 6
and 3 hour decision times. Separation at the source TCA is quadratic in the
impulse magnitude along a fixed direction, so the minimum delta-v has a closed
form and does not need the sampled sweep that ranks candidates. The panel shows
the propellant multiplier between the earliest and latest decision time, and
the required impulse rises with the inverse of lead time because the along-track
secular term dominates.

The green candidate path is a linearized HCW offset over the nominal SGP4 path.
It is a visual preview, not a new ephemeris. The UI keeps post-manoeuvre
probability null because public elements do not include the covariance and
hard-body radius needed for that calculation. A professional connector must
provide an operator CDM and run a full-catalogue re-screen before flight review.

`app/path-space-view.tsx` opens the encounter as a three-dimensional plot,
because a kilometre of separation against a 6,371 km Earth is a fraction of a
pixel on the globe. `app/lib/path-space.ts` rebuilds the geometry in the
satellite's local axes: along-track and cross-track span the horizontal plane
and radial is altitude, so height reads vertically. Both objects travel through
the frame with their own start markers, the current path is red, the recommended
burn green, and the remaining candidates blue. An arrow at each start shows the
impulse direction in the same axes.

The published miss distance sets the separation and propagation supplies only
its direction, which is the convention `buildManeuverStudy` already uses. That
keeps the plot and the panel identical at the published closest-approach time.
The plot also reports the true minimum over the window, which sits lower when a
burn moves when the encounter happens rather than only how far away it is.

Three framings run the corridor to three, eight or twenty-two times the widest
separation, and the fit control frames the drawn paths so both start points and
the closest approach stay in view.

The view holds its inputs from the moment it opens, because the workspace clock
re-renders its parent twice a second and rebuilding the scene on each of those
made it unusable. The renderer, camera and controls are created once, only the
drawn content is rebuilt when the framing or visible set changes, and frames are
rendered on demand rather than from a continuous loop.

Wide screens use the three-part workspace. Between 701 and 980 pixels, the
analysis rail moves below the fleet and globe instead of covering the WebGL
scene. Narrow screens order the globe first, the selected analysis second, and
the monitoring rail last.

## Public screening lane

CelesTrak OMM records provide orbital elements for SGP4 context. A small
timestamped public fixture supplies fresher TLE fallback records for six
monitored objects. Five came through SatNOGS DB with Space-Track.org attribution;
ISTSAT-1 came from the CelesTrak GP endpoint. Other monitored objects retain the
normal catalogue fallback when the fixture has no current TLE. SOCRATES records
provide the displayed public conjunction metrics. Transparent rules
assign Review, Watch, Low, or Needs data. Public geometry remains approximate,
and the SOCRATES values remain authoritative for the event card.

The browser loads the bundled screening response immediately, then requests the
current SOCRATES run in the background. The upstream run is about 16 MB, so its
download receives a dedicated 45-second allowance while the smaller catalogue
requests retain their 15-second limit. The CSV is parsed once for both the
fleet events and total run count. The live route is not browser-cached; server
and edge caches still prevent repeated upstream downloads across the roughly
10.5-hour SOCRATES update cycle. A current run served from that synchronized
cache remains identified by its source timestamp instead of being called a
generic fallback.

The overview uses a bundled timestamped threat fixture instead of issuing one
CelesTrak request per counterpart. Selecting an event requests only that pair's
current public records. Removing the per-counterpart live fetch invalidated the
`threat-overlay-current` edge-cache entries, whose stored source string still
named a live GP OMM refresh. The threat overlay now reads and writes
`threat-overlay-snapshot-v2`, so a cached response can only describe a source
the current code actually uses. Blank SOCRATES numeric cells stay null and produce
Needs data instead of becoming zero. Active queues and threat aggregates omit
events whose TCA has passed.

`ConjunctionResponse.screenedCatalogIds` names the objects a screening run
actually covered. The bundled run reports its own fleet list and the current run
reports the configured watchlist, so an empty event list means Clear only for a
covered object. A monitored satellite outside that list reports Connector needed
instead of a false Clear. This invalidated `socrates-current-run` edge-cache
entries, which carried no coverage list, so the key is now
`socrates-current-run-v2`.

The default satellites have known screening coverage in the bundled and
current fleet feed. A judge can add any active payload to device-local storage
for orbit monitoring. A custom payload shows Connector needed until a screening
or CDM provider supplies conjunction coverage, so zero returned events never
appear as a false Clear state.

The deployed public-feature model accepts events inside 48 hours. It maps TCA,
maximum probability, minimum range and relative speed to the same four numeric
features used during training. A 37-tree Histogram Gradient Boosting classifier
raises an alert when its score crosses 0.67. It reaches 0.631 test F2, 0.933
test recall and 0.529 test PR-AUC on an event-held-out split. The score ranks
analyst review and does not replace the source probability.

Elevated events inside the 24 to 48 hour planning window rank ahead of late or
more distant events. A named debris counterpart breaks the next tie, followed
by source maximum probability, model score, and time to TCA. The left rail
exposes only the primary alert and reports how many elevated events remain
queued. Repeated raw scores
are possible when events land in the same gradient-boosting leaves, so the
alert card displays the source probability while the selected-event view shows
the raw model score and threshold once.

## CDM intelligence lane

The Python pipeline groups ESA CDM rows by event, removes information inside
the final two-day interval, engineers temporal and covariance features, and
keeps events separate across train, validation, and test partitions. Event
9051 remains reserved for regression tests outside the current judge path.

Latest-risk persistence is the safety baseline. The benchmark trains Logistic
Regression, Random Forest, Histogram Gradient Boosting, LightGBM and a
Multi-Layer Perceptron on the same event-held-out split. Histogram Gradient
Boosting leads validation F2 at 0.859 and reaches 0.846 test F2. LightGBM reaches
the highest model test PR-AUC at 0.856. The MLP does not improve the benchmark.
The five-model benchmark remains evidence for the future professional tier. The
current UI exposes the deployed public-feature model's input coverage,
event-held-out metrics and calibration limit.

`POST /api/model/score` is the provider-neutral live inference boundary. It
accepts one event's ordered CDM messages, rejects evidence inside the T-2
cutoff, rebuilds the same 76 engineered features used in training, and executes
the exported 67-tree Histogram Gradient Boosting champion. The TypeScript tree
evaluator matches the Python model after every message in the reserved event
sequence. Responses carry the model identity, input coverage, threshold,
triage score and an explicit non-probability warning.

`GET`, `POST` and `DELETE /api/model/live` provide an experimental CDM ingestion
surface for the professional tier. A provider can post one CDM at a time. The
current worker isolate retains the active event and updates its score after
every arrival. `CDM_INGEST_TOKEN` can protect writes when configured. A
production deployment replaces it with durable event storage or a direct
provider query.
An external connector may include an absolute `tca` value. The route normalizes
it to ISO time, and every judge-facing absolute timestamp is formatted in India
Standard Time. The ESA archive provides a relative T-minus timeline but no
trustworthy absolute event time, so the test feed states that limit.

The CDM endpoint remains available for future operator connectors and model
research. The judge-facing workspace does not start a historical or anonymized
replay. Its alerts come from named events in the current public feed.

The accelerated TCA replay uses a fixed twenty-minute window and a 6.5-second
presentation duration. Camera phases follow the protected object, acquire the
pair, and then frame the encounter. At Earth scale the pair is necessarily
nearly coincident, so the final debris view is a labelled magnified schematic
using the authoritative SOCRATES miss range rather than fabricated geometry.

## Offline behavior

Bundled catalogue, monitored-fleet TLE, conjunction, threat and public-model
fixtures keep the complete judge path available without network
access. Python training artifacts stay outside Git. The committed model export
contains only the selected estimator, preprocessing values, model identity and
source hash needed for deterministic inference.

## Stable contracts

- `DataStatus`: `current`, `cached`, or `unavailable`.
- `ScreeningPriority`: `review`, `watch`, `low`, or `needs-data`.
- Public event metrics retain source timestamps and nullable source fields.
- Public screening candidates and elevated two-day model alerts remain
  distinguishable in every view.
- Only a complete event inside 48 hours can populate the live ML alert queue.
- Judge-facing absolute timestamps use India Standard Time.
- Model results never overwrite SOCRATES fields or claim operational authority.
- Manoeuvre candidates expose separation at the original TCA, delta-v,
  propellant, and assumptions. They never expose an unvalidated post-burn Pc.
- Custom monitored payloads require an explicit coverage connector before the
  interface can label their screening state Clear.
- The T-2 cutoff and reserved-event identity travel with every replay result.
- Live model input below the T-2 cutoff is rejected before feature generation.
- External and held-out test feeds remain visibly distinguishable.
