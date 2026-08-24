# OrbitShield AI

OrbitShield is an AI-assisted conjunction-triage workspace for small satellite teams. It turns public screening traffic into one explainable review, follows the protected satellite and debris to closest approach, then demonstrates a trained T−2 triage model on a held-out ESA event.

The hackathon demonstration has two evidence lanes:

- **Public screening:** CelesTrak OMM context, SOCRATES metrics, transparent Review/Watch/Low rules, and a debris-focused India Earth Observation fleet workflow.
- **Historical AI replay:** nine ESA CDMs visible through a strict T−2 cutoff, a latest-risk persistence baseline, a trained LightGBM priority signal, grouped evidence, and a recorded-outcome reveal.

The 3D globe uses SGP4-propagated public elements for context. The accelerated follow compresses a 20-minute encounter window into 6.5 seconds and finishes with a clearly labelled magnified schematic. SOCRATES values remain authoritative; conflicting public-element R–T–N geometry is hidden rather than presented as exact.

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

The model output is a raw triage score, not collision probability. OrbitShield is preliminary decision support: it does not confirm collisions, recommend manoeuvres, or replace a qualified flight-dynamics analyst.
