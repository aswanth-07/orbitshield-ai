# OrbitShield AI prototype

Interactive rendering proof for a two-day internal hackathon proposal in the Space Technology theme.

The prototype deliberately separates two experiences:

- **Orbit Monitor** renders 512 deterministic representative objects around an interactive Earth, with filters, selected orbit trails, conjunction cards, time controls and a clearly magnified encounter inset.
- **AI Historical Replay** uses a relative R-T-N encounter view and representative saved inference values to demonstrate the intended ESA event-replay interaction. It does not invent an absolute historical Earth position.

All cards are labelled as representative prototype data. Production implementation should replace them with a timestamped CelesTrak OMM/SOCRATES cache and leakage-safe predictions trained on ESA CDM event groups with a strict T-2-day cutoff.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`.

## Validate

```powershell
npm run build
```

This is an educational and preliminary-screening interface, not an operational collision warning or manoeuvre recommendation system.
