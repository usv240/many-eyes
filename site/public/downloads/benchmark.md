One viewer alone: 75.9%. Ten viewers including three trolls, weighted by hidden checks: 89.2% correct on the 81.3% of tiles they validated; the rest were refused and sent to experts.

## Cohorts

| viewers | trolls (wrong / raid) | honest-voter mean (median; p10–p90) | weighted acc. | unweighted acc. | weighted coverage | unweighted coverage |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 / 0 | 75.9% (75.5%; 68.7%–83.3%) | n/a | n/a | 0.0% | 0.0% |
| 5 | 1 / 1 | 75.4% (75.8%; 66.6%–83.4%) | 85.5% | 76.4% | 77.2% | 51.3% |
| 10 | 1 / 2 | 76.1% (76.6%; 68.8%–84.0%) | 89.2% | 87.4% | 81.3% | 76.2% |
| 15 | 2 / 3 | 76.0% (76.1%; 69.7%–83.3%) | 89.2% | 85.3% | 81.1% | 67.3% |
| 25 | 3 / 5 | 75.8% (75.9%; 68.5%–83.1%) | 89.6% | 86.4% | 84.0% | 66.3% |

Accuracy is calculated over validated gold tiles; coverage is validated tiles divided by all gold tiles. Honest-voter accuracy uses each non-troll voter's raw non-unsure votes.

## Ten-viewer accuracy by difficulty

| difficulty | mix | weighted accuracy | unweighted accuracy | weighted coverage | unweighted coverage |
|---|---:|---:|---:|---:|---:|
| easy | 65.0% | 99.9% | 99.8% | 90.0% | 85.0% |
| hard | 25.0% | 96.1% | 91.8% | 56.8% | 48.4% |
| misleading | 10.0% | 0.0% | 0.0% | 86.2% | 89.5% |

## Ten-viewer learning curve

| gold tiles | weighted accuracy | unweighted accuracy | weighted coverage | unweighted coverage |
|---|---:|---:|---:|---:|
| 1–20 | 91.5% | 89.5% | 79.8% | 76.5% |
| 21–40 | 88.7% | 87.5% | 82.0% | 76.0% |
| 41–60 | 86.7% | 85.0% | 82.5% | 76.5% |
| 61–80 | 89.8% | 87.5% | 81.0% | 75.8% |

## Limits

Voter sensitivity and specificity are based on Herfort et al. 2019 (MapSwipe).
The 65% easy, 25% hard, 10% misleading mix and both troll tactics are simulation assumptions.
Intact gold is inferred from OSM buildings more than 40 m from any Copernicus damage point.
The crowd is simulated; these results do not measure real Twitch viewers.

<!-- AI-ALONE:START -->
## AI alone (real cached imagery measurement)

AI alone: 73.8% on 80 hidden checks (destroyed 100.0%, intact 47.5%).

Model: gpt-6-luna. API measurement dates (UTC): 2026-11-01. Scored: 2026-11-01T20:08:18.627Z.

One binary model prediction per building from the two centred crops; no gold membership, expert grade, building ID or coordinates were provided to the model.
This is a real API measurement, not a simulated crowd. Intact gold is inferred from OSM distance to damage points, not a field survey.

### Agreement with experts on the 110 work-queue tiles

Binary agreement with experts: **not measurable (0/110 have comparable binary expert labels)**. Damaged and Possibly damaged are neither destroyed nor intact; no mapping has been invented. The cross-tab below reports AI labels by the original expert grade, not accuracy.

| Expert grade | AI destroyed | AI intact | Total |
|---|---:|---:|---:|
| Possibly damaged | 46 | 32 | 78 |
| Damaged | 25 | 7 | 32 |

Per-building labels, confidence, crop hashes and timestamps are recorded in reports/ai-alone.json. Reproduce with npm run debates:score against the matching debate/crop caches.
<!-- AI-ALONE:END -->
