# OrbitShield T-2 risk model

This training pipeline uses the official ESA Collision Avoidance Challenge CDM archive. It predicts the final log10 collision risk using only messages available at least two days before time of closest approach.

The first model is deliberately conservative:

- latest-risk persistence is always measured as the baseline;
- a LightGBM regressor learns the correction to the latest known risk;
- a separate class-weighted LightGBM classifier estimates whether final risk crosses the `10^-6` review threshold;
- events are split before training, and ESA demonstration event `9051` is excluded entirely.

Run from the repository root:

```powershell
.\.venv-ml\Scripts\python.exe .\ml\train_model.py
```

Generated models and metrics are written to `ml/artifacts/` and are intentionally not committed.
