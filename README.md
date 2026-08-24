# OrbitShield AI

OrbitShield is an automated conjunction-monitoring workspace for small satellite teams. It watches a selected fleet, raises close-approach alerts from current public screening, explains the selected risk in plain language, and follows the protected satellite and debris to closest approach on a live 3D globe.

The hackathon demonstration keeps two evidence lanes in one persistent product view:

- **Automated public monitoring:** CelesTrak OMM context, SOCRATES metrics, transparent Review/Watch/Low alerts, and six India Earth Observation missions.
- **CDM model evidence:** five event-held-out model families trained on ESA CDM histories. Histogram Gradient Boosting leads validation F2, while the interface states when a public event lacks the covariance history required for model inference.

The central globe opens on six solid green monitored orbits and screened debris; the larger active catalogue is available from the optional Context control. SGP4 propagation animates the orbital picture. The accelerated follow compresses a 20-minute encounter window into 6.5 seconds, renders the protected orbit as solid green, renders the counterpart orbit as a coloured dashed path, and finishes with a labelled magnified schematic. SOCRATES values remain authoritative.

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

The model output is a raw triage score, not collision probability. OrbitShield raises prototype monitoring alerts and supports preliminary review. It does not confirm collisions, recommend manoeuvres, or replace a qualified flight-dynamics analyst.
