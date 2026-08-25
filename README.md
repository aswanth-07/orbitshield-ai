# OrbitShield AI

OrbitShield is an ML conjunction-risk workspace for small satellite teams. Current public screening identifies possible close approaches. A deployed two-day Histogram Gradient Boosting model scores every complete fleet event from time to TCA, present risk, miss distance and relative speed. Only elevated scores enter the analyst queue. The workspace explains the evidence and follows the protected satellite and counterpart to closest approach on a live 3D globe.

The hackathon demonstration keeps two evidence lanes in one persistent product view:

- **Live two-day triage:** a 37-tree feed-compatible model scores current fleet events inside 48 hours and raises named, globe-mapped alerts. Its event-held-out test F2 is 0.631 and recall is 0.933.
- **Professional model research:** five model families use the richer ESA CDM histories for the future operator-data tier. This benchmark remains technical evidence rather than the main judge workflow.

The central globe opens on the monitored fleet and screened debris; the larger active catalogue is available from the optional Context control. A visible ESA CDM evidence card compares all five researched models and identifies the 76-feature professional-tier champion without mixing it into the live public alert source. Selecting a live ML alert starts the globe replay in one click. SGP4 propagates both objects across the final 20-minute approach, while a chase camera follows the protected satellite. The protected and counterpart paths remain distinct and a pulsing red target marks closest approach. All judge-facing absolute times, including TCA, are displayed in India Standard Time. SOCRATES values remain authoritative for source metrics.

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

The model output is a raw triage score, not collision probability. The current model accepts only complete events inside its trained 48-hour horizon and rescans the feed every minute. OrbitShield does not confirm collisions, recommend manoeuvres, or replace a qualified flight-dynamics analyst.
