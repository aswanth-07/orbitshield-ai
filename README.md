# OrbitShield AI

OrbitShield is an ML conjunction-risk workspace for small satellite teams. Public screening identifies possible close approaches, compatible operator CDMs feed a trained Histogram Gradient Boosting model, and only an elevated model score becomes an analyst alert. The workspace explains the evidence and follows the protected satellite and counterpart to closest approach on a live 3D globe.

The hackathon demonstration keeps two evidence lanes in one persistent product view:

- **Public candidate intake:** CelesTrak OMM context, SOCRATES metrics, transparent Review/Watch/Low screening priorities, and six India Earth Observation missions. These rows are candidates, not ML alerts.
- **ML risk prediction:** five event-held-out model families trained on ESA CDM histories. Histogram Gradient Boosting leads validation F2 and scores each compatible CDM sequence through the live endpoint. The held-out ESA Mission 1 pair starts automatically, receives nine unique CDMs and raises one model-driven elevated alert.

The central globe opens on the monitored fleet and screened debris; the larger active catalogue is available from the optional Context control. SGP4 propagation follows the selected 1×, 10× or 60× simulation clock for the catalogue, fleet and risk objects. Public-candidate follow compresses a 20-minute encounter window into 6.5 seconds. Selecting the ML alert opens a separate 6.5-second magnified R–T–N replay built from the held-out CDM miss vector and relative velocity. All judge-facing absolute times, including public TCA, are displayed in India Standard Time. SOCRATES values remain authoritative for public screening candidates.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`.

## Validate

```powershell
npm test
npm run lint
npm run build
```

Train the five-model benchmark with:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\benchmark_models.py
```

The model output is a raw triage score, not collision probability. OrbitShield raises an analyst alert when a compatible CDM sequence crosses the trained model threshold. An external CDM connector can include an absolute `tca` timestamp in `POST /api/model/live`; the interface normalizes and displays it in IST. The held-out ESA test feed has only a relative T− timeline because its absolute event time is anonymized. OrbitShield does not confirm collisions, recommend manoeuvres, or replace a qualified flight-dynamics analyst.
