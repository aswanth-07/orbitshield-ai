---
title: OrbitShield Five-Model Benchmark
updated: 2026-08-25
status: active
---

# Five-model benchmark

OrbitShield benchmarks five classification families on the ESA Collision
Avoidance Challenge archive. Every model uses 76 engineered features from CDMs
available at least two days before closest approach. Events stay intact across
8,358 training, 1,791 validation and 1,792 test examples. The test partition
contains 48 high-risk events. Event 9051 remains outside all partitions.

## Results

| Model | Validation F2 | Test F2 | Test recall | Test PR-AUC |
|---|---:|---:|---:|---:|
| Logistic Regression | 0.619 | 0.650 | 0.875 | 0.546 |
| Random Forest | 0.830 | 0.801 | 0.938 | 0.829 |
| Histogram Gradient Boosting | **0.859** | **0.846** | 0.917 | 0.840 |
| LightGBM | 0.847 | 0.827 | 0.896 | **0.856** |
| Multi-Layer Perceptron | 0.633 | 0.545 | 0.729 | 0.490 |

Latest-risk persistence remains the safety baseline. It reaches 0.842 test F2
and 0.958 recall. Histogram Gradient Boosting is the benchmark champion because
validation F2 selects the model before test results are inspected. The complete
five-model run, including feature preparation, takes 16.15 seconds on the
development laptop.

## Research basis

- The [ESA dataset](https://kelvins.esa.int/collision-avoidance-challenge/data/)
  defines the CDM fields, event structure and T-2 cutoff.
- The [challenge design and results paper](https://arxiv.org/abs/2008.03069)
  documents the imbalanced final-risk prediction problem.
- An [ESA proceedings comparison](https://conference.sdo.esoc.esa.int/proceedings/sdc8/paper/33)
  evaluates decision-tree ensembles, gradient boosting, MLP and LSTM methods on
  conjunction data.
- A [Bayesian and Hidden Markov Model study](https://arxiv.org/abs/2311.10633)
  supports retaining persistence and sequential probabilistic models as serious
  baselines.

The benchmark scores triage classes and does not produce calibrated collision
probabilities. Public SOCRATES records lack the covariance history required by
these CDM models.
