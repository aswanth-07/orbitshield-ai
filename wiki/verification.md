---
title: OrbitShield Verification
updated: 2026-08-25
status: active
---

# Verification

## Supported runtimes

- Node.js 22 or newer, as declared in `package.json`.
- Python 3.10 with the packages pinned in `ml/requirements.txt`.

## Web checks

Run the focused test for the changed module, then run:

```powershell
npm test
npm run lint
npm run build
npx tsc --noEmit --incremental false
```

UI changes also require browser verification at 1707x1067, 1366x768, and a
narrow mobile viewport. Exercise the complete judge path, inspect the console,
confirm the cached fallback remains usable, and verify the TCA replay reaches
the exact event time after follow, acquire, and encounter phases.

The monitoring workflow check adds an active catalogue payload, confirms that
it persists locally with Connector needed, removes or resets it, selects the
primary ML alert, runs the TCA replay, opens the advisory manoeuvre study, and
confirms that the green HCW preview never invents post-manoeuvre probability.
Record console errors and a replay frame-rate sample for the primary laptop.

## Model checks

Use the repository environment instead of a global Python installation:

```powershell
.\.venv-ml\Scripts\python.exe -m py_compile .\ml\train_model.py
.\.venv-ml\Scripts\python.exe .\ml\train_model.py
.\.venv-ml\Scripts\python.exe .\ml\export_validation_replay.py
.\.venv-ml\Scripts\python.exe -m py_compile .\ml\train_public_triage.py
.\.venv-ml\Scripts\python.exe .\ml\train_public_triage.py
```

Record event counts, split sizes, baseline metrics, model metrics, runtime, and
the exclusion status for event 9051. Generated artifacts under `ml/artifacts`
remain local.

## Documentation checks

Documentation-only changes require Git status, scoped whitespace checks,
relative-link checks, and review for machine-specific paths. They do not
require a production build or model training run.
