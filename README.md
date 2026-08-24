# OrbitShield AI

OrbitShield is an interactive 3D orbital-traffic and conjunction-risk explorer built for the Space Technology theme.

The current interface includes:

- live CelesTrak catalogue context and SOCRATES conjunction metrics;
- bright-green satellite markers and size-coded debris markers;
- persistent watchlist orbits and focused satellite/debris encounter paths;
- **Follow**, **Encounter**, **Free 3D**, and **Reset** camera modes with rotate, pan, zoom-to-cursor, and touch controls;
- a collision-candidate workflow that isolates one pair, moves to TCA, and marks the public-element closest-approach approximation; and
- an oblique R-T-N depth inset with a separately magnified normal axis so out-of-plane separation remains readable.

SOCRATES values remain the authoritative public conjunction metrics shown by the UI. The plotted orbit geometry and closest-approach position are contextual approximations based on public orbital elements and are not operational manoeuvre guidance.

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
