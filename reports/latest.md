| Measurement | Result | Source |
|---|---|---|
| One viewer alone (simulated, Herfort 2019 rates) | 75.9% | Honest-voter raw accuracy; [benchmark](bench.md), bench ledger replay |
| Ten viewers with three trolls, weighted by hidden checks (simulated) | 89.2% on 81.3% validated | [Benchmark](bench.md), bench ledger replay |
| AI alone (real API measurement) | 73.8% (destroyed 100.0%, intact 47.5%) | gpt-6-luna; 2026-11-01; [cached predictions](ai-alone.json) |
| AI false alarms on intact buildings | 52.5% | 21/40 intact hidden checks; same API measurement |

# Nepal flood mission report

The AI's false alarms are the reason chat checks the AI rather than the reverse. AI arguments never enter consensus.decide().

## Recorded demo and exports

Run `fb204a6a-030e-478e-87ff-98dc353eccd7` in `data/video-ledger.jsonl` is a deliberately selected six-tile recording with a simulated crowd, not a benchmark sample.
All export labels are recomputed from accepted ledger votes through consensus.decide(). This run has **5 validated** buildings and **1 refused** buildings, queued for expert review.
The ten-viewer benchmark separately refused 299 of 1600 gold presentations across seeds.

[Validated GeoJSON](nepal-flood-2026-validated.geojson) and [refused GeoJSON](nepal-flood-2026-refused.geojson) contain WGS84 longitude/latitude Points for humanitarian mappers to inspect and reconcile with HOT Tasking Manager work. They are demonstration review inputs, not an operational damage inventory or automatic HOT upload. Gold checks remain identified in exports; refused points carry their review reason.

## Limits

- The crowd is simulated. Sensitivity and specificity use Herfort et al. 2019 (MapSwipe) rates. The difficulty mix and troll tactics are assumptions, not measured Twitch behaviour.
- Intact gold is inferred from OSM buildings more than 40 m from any Copernicus damage point; it is not an expert intact survey.
- On misleading tiles, ten-viewer weighted accuracy is 0.0%. These are 10% of the assumed benchmark mix; shared mistakes can produce confident consensus.
- Typical pre/post photo offset is 1.7 m (median over 40 intact gold pairs; grayscale Hann-window phase correlation). See [measurement and spread](overlay/offset-measurement.json).
- Live simulation only: Damaged work tiles use private destroyed truth at hard difficulty. Possibly damaged work tiles keep a shared 50/50 private truth at hard difficulty. This assumption generates votes only; it does not supply ledger labels, change decide(), or enter published benchmark metrics.
- The video seed and six buildings were searched for illustrative outcomes. Its counts must not be used as an accuracy estimate. The benchmark remains gold-only and unchanged.
- Work grades Damaged and Possibly damaged cannot establish binary destroyed/intact accuracy or agreement. AI labels by expert grade are descriptive only.

## Provenance and regeneration

`npm run report` replays the recorded video ledger and regenerates this report, its JSON manifest, both GeoJSON files and the README table. `npm run verify` checks live, benchmark and video hash chains, replays votes and compares published artifacts. `reports/latest.json` remains the independently verified benchmark; `reports/latest.md` is this human-readable mission companion. AI numbers are recomputed from the recorded API predictions against mission gold, not from the simulation.

Attribution: Imagery: Vantor via OpenAerialMap, CC BY-NC 4.0. Damage grading: © European Union, Copernicus Emergency Management Service (EMSR927). Buildings: © OpenStreetMap contributors, ODbL.
