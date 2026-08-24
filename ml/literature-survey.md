# Compact literature survey

OrbitShield uses the ESA Collision Avoidance Challenge as its primary research
and evaluation basis. ESA defines each conjunction as a time series of
Conjunction Data Messages (CDMs) and asks models to predict the final risk using
only information available at least two days before closest approach.

## Reviewed work

| Source | Relevant finding | OrbitShield decision |
|---|---|---|
| [ESA challenge data](https://kelvins.esa.int/collision-avoidance-challenge/data/) | 162,634 CDMs, 13,154 events, 103 fields and a strict T-2 decision cutoff | Preserve event groups, engineer temporal features and prevent post-cutoff leakage |
| [Challenge design and results](https://arxiv.org/abs/2008.03069) | Real collision-risk evolution is difficult, imbalanced and strongly affected by the latest CDM | Keep latest-risk persistence as the safety baseline and optimize F2 for recall |
| [Data-based method comparison](https://conference.sdo.esoc.esa.int/proceedings/sdc8/paper/33) | Decision-tree ensembles, gradient boosting, MLP and LSTM models are relevant conjunction-data candidates | Benchmark Random Forest, two boosting implementations and an MLP on one split |
| [Bayesian and HMM study](https://arxiv.org/abs/2311.10633) | Persistence is strong and the risk sequence may have a Markov structure | Keep sequence models as future work; compare five models that train reliably during the hackathon |

## Five-model benchmark

1. Logistic Regression provides an interpretable linear sanity check.
2. Random Forest tests bagged nonlinear decision trees.
3. Histogram Gradient Boosting supplies a framework-independent boosting model.
4. LightGBM represents efficient leaf-wise gradient boosting and supports the
   existing explanation pipeline.
5. A Multi-Layer Perceptron tests a neural representation of the same T-2
   feature set.

Every model uses the same event-held-out train, validation and test partitions.
Validation data selects each classification threshold and the benchmark
champion. Test data reports the final comparison. ESA event 9051 remains outside
all three partitions for the interface replay.
