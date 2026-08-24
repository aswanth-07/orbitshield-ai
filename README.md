# OrbitShield AI

OrbitShield is an automated conjunction-monitoring workspace for small satellite teams. It watches a selected fleet, raises close-approach alerts from current public screening, explains the selected risk in plain language, and follows the protected satellite and debris to closest approach on a live 3D globe.

The hackathon demonstration keeps two evidence lanes in one persistent product view:

- **Automated public monitoring:** CelesTrak OMM context, SOCRATES metrics, transparent Review/Watch/Low alerts, and six India Earth Observation missions.
- **CDM model evidence:** an event-held-out LightGBM priority model trained on ESA CDM histories. The interface states when a public event lacks the covariance history required for that model.

The central globe keeps the monitored orbits, active catalogue and screened debris visible. SGP4 propagation animates the orbital picture. The accelerated follow compresses a 20-minute encounter window into 6.5 seconds and finishes with a labelled magnified schematic. SOCRATES values remain authoritative.

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

The model output is a raw triage score, not collision probability. OrbitShield raises prototype monitoring alerts and supports preliminary review. It does not confirm collisions, recommend manoeuvres, or replace a qualified flight-dynamics analyst.
