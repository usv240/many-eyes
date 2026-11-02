# Many Eyes

**Twitch chat checks the AI's disaster map.**

Website: https://usv240.github.io/many-eyes/ · Code: https://github.com/usv240/many-eyes · Built for the Codex x TwitchCon Hackathon 2026

## In 60 seconds

After a disaster, AI marks thousands of buildings as damaged within days, and nobody can trust those marks until people check them. After the Nepal flood of 26 August 2026, the Humanitarian OpenStreetMap Team's AI scored over 1,000 buildings in 48 hours, published as "not yet human validated". Checking is the bottleneck.

Many Eyes puts each building on a Twitch stream, before and after the flood:

1. A tile opens for 15 seconds with real satellite photos of one building in Syaphru Besi, Nepal.
2. Two AI debaters argue, one for destroyed and one for intact, each pointing at the photo. They never vote.
3. Chat types `1` destroyed, `2` intact or `3` unsure. Votes arrive through Twitch EventSub.
4. A label is **validated** only with at least 66% weighted agreement from at least 3 voters. Otherwise the building is **refused** and sent to experts.
5. About 40% of tiles are **hidden checks** with known expert answers from Copernicus EMS. They show chat's accuracy live, and voters who get them right count for more.
6. The bot posts each result in chat. Validated buildings export as GeoJSON for humanitarian mappers, and every vote sits in a hash-chained ledger that `npm run verify` re-checks.

## The numbers

| Measurement | Result | Kind |
|---|---|---|
| AI alone (gpt-6-luna, 80 hidden checks) | 73.8% (destroyed 100%, intact 47.5%) | Real API measurement, 1 Nov 2026 |
| AI false alarms on standing buildings | 52.5% | Real API measurement |
| One viewer alone | 75.9% | Simulation, MapSwipe-derived rates (Herfort et al. 2019) |
| Ten viewers including three trolls, weighted by hidden checks | 89.2% on the 81.3% of tiles validated; the rest refused | Simulation |

The AI calls half of the standing buildings destroyed. That is why people check the AI, and not the other way round. Every number above is recomputed from the committed ledgers by `npm run verify`.

## Try it in 2 minutes (no keys needed)

```
git clone https://github.com/usv240/many-eyes
cd many-eyes
npm ci
cp .env.example .env
npm run demo        # open http://localhost:5180 (the OBS overlay)
npm test            # 170+ tests
npm run verify      # recompute every published number from the ledgers
```

The demo uses a simulated crowd and the cached AI debates, so it needs no Twitch or OpenAI keys and works offline. The website runs locally with `npm run site:dev`.

## Glossary

- **EventSub**: Twitch's live event feed. Many Eyes reads every chat message through it over a WebSocket.
- **Hidden check (gold tile)**: a building whose answer experts already know. Viewers cannot tell which tiles are checks.
- **Consensus**: the rule that turns votes into a label, at least 66% weighted agreement from at least 3 voters.
- **Refused**: no label, because chat split or too few voted. The building goes to an expert queue.
- **Weighting**: every voter starts at 1.0; a right hidden check adds 0.1, a wrong one removes 0.2, kept between 0.2 and 2.0.
- **Copernicus EMS**: the European Union's emergency mapping service, whose experts graded the damage (activation EMSR927).
- **OpenAerialMap**: open satellite imagery; the photos here are Vantor imagery under CC BY-NC 4.0.
- **MapSwipe**: a volunteer app for checking map imagery; its measured accuracy calibrates the simulation.
- **GeoJSON**: the standard file format for map features, readable by QGIS, JOSM and the HOT Tasking Manager.

## Run it live on Twitch

1. Register a Twitch app (category Chat Bot) and create a user token with the Twitch CLI:
   ```
   twitch token -u -s "user:read:chat user:write:chat user:bot channel:bot channel:manage:broadcast"
   ```
2. Fill `TWITCH_CLIENT_ID`, `TWITCH_USER_TOKEN`, `TWITCH_REFRESH_TOKEN`, `TWITCH_BOT_USER_ID` and `TWITCH_BROADCASTER_USER_ID` in `.env`. To refresh later, run `twitch token -R <refresh token>` (capital R; lowercase -r revokes).
3. Choose a mode:
   - `npm run demo:mixed`: simulated crowd **plus** your real chat. Real votes go through the same parse, dedupe and replace path, and the overlay shows "Simulated crowd + live chat".
   - `npm run live`: real chat only.
4. In OBS, add a Browser Source at `http://localhost:5180`, 1920 by 1080.

Chat commands: `1`, `2`, `3` (or `!1`, `destroyed` and so on) to vote, and `!why` for a short explanation with the repo link. First-time voters get one welcome reply. The bot sends at most one message per second.

While the channel is live, every decided building also drops a **Twitch stream marker** ("Many Eyes · Tile 14: validated intact, 81% agreement, 23 voters"), so the saved broadcast becomes an index a responder can jump through. Markers need the `channel:manage:broadcast` scope; without it they switch off quietly.

## Bring your own data, and the developer API

- **Website data page**: upload a CSV of `tile_id,user_id,vote[,truth][,lon][,lat]` and get validated or refused labels, accuracy on your own hidden checks, voter weights and GeoJSON. It runs the same engine in the browser. Three presets are included and downloadable.
- **Developer API**, served by `npm run demo` on port 8791:
  - `POST /v1/keys` issues a key, shown once and stored only as a SHA-256 hash, 5 per hour per address.
  - `POST /v1/decide` decides up to 5,000 tiles and 200,000 votes, with a Bearer key, 60 requests per minute.
  - `GET /v1/openapi.json` describes it all.
- The website's API page can issue a key and call a running server, or use an in-browser sandbox of the same function.

## How it was built

**OpenAI Codex** wrote the core in one main thread, session `01a18e68-04f2-73b0-b14f-b84aa906c1c5`, phase by phase: Twitch EventSub and vote parsing; missions and imagery; consensus engine, ledger and simulated crowd; the live state stream and broadcast overlay; the AI debaters; exports and reports. `AGENTS.md` held the rules Codex followed in every phase (no extra dependencies, votes deduplicated by message id, no label written without `consensus.decide()`, careful wording, code-review rules), and two repository skills in `.agents/skills` taught it the Twitch EventSub protocol and the mission report format.

**Claude Code** wrote the phase prompts and reviewed every phase by running it and looking at screenshots. Review found two problems that Codex then fixed with regression tests. The first benchmark scored about 100% because simulated errors were independent, so it was rebuilt with shared hard and misleading tiles, always-wrong trolls and raids. And every satellite crop had been cut from the wrong corner of the map, because the image library runs extract before composite. Claude Code also built the later parts directly: mixed live mode, `!why` and welcome replies, the developer API, the bring-your-own-data page and the website.

## Sources

- HOT, [Mapping the Nepal Floods](https://www.hotosm.org/en/news/mapping-the-nepal-floods/)
- Copernicus EMS, [activation EMSR927](https://mapping.emergency.copernicus.eu/activations/EMSR927)
- Herfort et al. 2019, [Remote Sensing 11(15)](https://www.mdpi.com/2072-4292/11/15/1799)
- Gross et al. 2023, [AGILE GIScience Series 4](https://agile-giss.copernicus.org/articles/4/5/2023/)
- Khan et al. 2024, [Debating with more persuasive LLMs leads to more truthful answers](https://arxiv.org/abs/2402.06782)
- [OpenAerialMap](https://openaerialmap.org) and [OpenStreetMap](https://www.openstreetmap.org/copyright)

## Licences

Code: MIT, see `LICENSE`. Imagery: Vantor via OpenAerialMap, CC BY-NC 4.0. Damage grading: European Union, Copernicus Emergency Management Service (EMSR927). Buildings: OpenStreetMap contributors, ODbL. These data licences apply to the files in `data/` and are not changed by the code licence.

# Technical details

## Run commands

- `npm install`: install workspace dependencies.
- `npm run dev`: alias for the simulated broadcast scene.
- `npm run demo`: run a simulated mission and Vite; prints the OBS URL (`http://localhost:5180/`).
- `npm run live`: run the same scene with Twitch chat as its vote source.
- `npm run dev:server`: run the HTTP server and one real-time mission, with SSE at `/api/stream`.
- `npm run dev:bot`: connect to Twitch, send one startup announcement, and log parsed votes.
- `npm test`: run Vitest.
- `npm run lint`: run ESLint and TypeScript checks.
- `npm run verify`: verify published report data against the ledger.
- `npm run mission -- nepal-flood-2026 sim`: run 15-second voting windows and 5-second pauses.
- `npm run mission -- nepal-flood-2026 twitch`: use Twitch votes and announce one result per tile.
- `npm run bench`: simulate 80 gold tiles at 1, 5, 10, 15, and 25 voters over 20 seeds, with shared hard tiles and troll raids.
- `npm run demo:mixed`: simulated crowd plus real Twitch chat votes.
- `npm run demo:video`: the scripted six-tile run used for the demo video.
- `npm run site:dev` and `npm run site:build`: the project website (landing page, bring-your-own-data page, API page).

Copy `.env.example` to `.env` and fill in credentials before connecting Twitch or OpenAI.

The server starts with an empty `.env`: `MANY_EYES_SOURCE` defaults to `sim` and
`MANY_EYES_SEED` to `7`. Set the source to `twitch` to require and use Twitch
credentials. The server owns one mission runner, with 15-second voting windows
and 5-second result pauses. Closing the server stops the runner and its streams.

`GET /api/stream` sends an unnamed SSE `data:` event containing the latest public
state immediately, then on every state change. It sends a `: ping` comment every
15 seconds. EventSource reconnects receive a fresh snapshot. `serverNow` is epoch
milliseconds for clock correction. The optional `debate` field carries cached claims and normalized after-photo boxes.
`live.voters` counts non-unsure voters and `live.unsure` counts unsure voters; ties
have no leading label. `stats.goldChecked` counts decided gold tiles and
`stats.goldCorrect` counts those validated with the correct label. `remaining`
includes the open tile. Detailed gold results appear after deciding and are
cleared from public state when the next voting window opens.

Tile responses include `zoom`, `sizePx`, and `lat`. Crops use 256-pixel XYZ tiles;
metres per crop pixel is `156543.03392 * cos(lat * Math.PI / 180) / 2 ** zoom`.

Public tiles use `/api/tiles/:token`. Tokens are the first 12 hex characters of
HMAC-SHA256 over run ID + building ID with a random process key. Only issued tokens
resolve, and the lookup map remains in the runner. Raw building IDs stay private;
HTTP mission summaries contain no building inventory. Stream coordinates have four
decimal places. Vite serves only overlay assets and dependencies, not mission data.

Use a 1920×1080 OBS browser source. Smaller windows scale the entire scene to fit.
The wipe travels between 15% and 85% over seven seconds per leg and parks at 50%
during results. Reduced motion parks the wipe and removes travel while retaining fades. The caution occupies a bottom strip inside the photo
stage because the specified stage/footer coordinates leave only an 8 px margin.
Public Sans is bundled in `overlay/public/fonts/` with its OFL license; no external
font request is needed. The font is from Google Fonts' Public Sans distribution.
The optional debate contract is `{ advocate: { claim, box? }, skeptic: { claim, box? } }`;
boxes use normalized crop coordinates `{ x, y, width, height }`. Claims are capped
at 22 words, and arguments never enter the consensus engine. The overlay converts
crop scale to display pixels and uses server timestamps to correct its countdown.
The server binds only `127.0.0.1`, on `PORT` (default `8791`). Vite also binds only
`127.0.0.1`, on `OVERLAY_PORT` (default `5180`), with strict port selection.
The demo probes `/api/missions` before startup and checks the server instance after
binding, refusing an occupied or unexpected service. The Vite proxy reads `PORT`
from `.env`; Twitch credentials are never sent to the browser.

Use Node 22 or newer. The bot reads `.env` from the repository root and requires the
Twitch client ID, user token, refresh token, bot user ID, and broadcaster user ID.
The user token must belong to the configured client and bot, with `user:read:chat`
and `user:write:chat` scopes. The bot uses outbound connections; it does not bind `PORT`.

Set optional `TWITCH_CLIENT_SECRET` to refresh an invalid token or one with less
than ten minutes remaining at startup. Refreshed tokens replace their entries in
`.env`. Without the secret, run `twitch token -R <refresh token>` when prompted and
update `.env`. Credentials and Twitch response bodies are never logged.

EventSub deduplicates the most recent 10,000 notification IDs. A server-directed
reconnect transfers the existing subscription; a lost connection creates a new
session and subscription. Twitch cannot replay chat missed during a disconnect.
The bot currently logs votes only; per-user replacement and tile closure belong
to the mission runner. Press Ctrl+C to stop the bot or runner.

## Overlay states and fixtures

Run `npm exec vite -- --config overlay/vite.config.ts` to preview fixtures without
starting the mission server. Open `http://localhost:5180/?fixture=intro` and replace
`intro` with `empty`, `voting`, `validated`, `refused`, `gold`, `loading`,
`disconnected`, or `complete`. `refused-few` and `gold-missed` cover the alternate
result copy. Fixtures use two bundled cached crops, verbatim mission attribution,
and illustrative public outcomes; they make no API or EventSource connection.

In live mode, the intro appears for ten seconds at tiles 1, 21, 41, and so on.
EventSource owns reconnection; a header notice appears after three seconds offline
while the last snapshot stays visible. Gold detail is displayed only in the decided
phase. Vote bars retarget with 180 ms scale transitions; countdowns use one linear
transition to the server deadline. Photos crossfade for 200 ms with a 2 px blur,
and result plates fade and move 8 px over 200 ms. No keyframe animations are used.

## Scoring and reproducibility

The runner emits public state through its typed `state` event. Gold truth appears
only after a tile is decided. Each user has one final vote per tile; updates replace
their earlier vote until the deadline. Unsure votes do not enter the agreement or
minimum-voter count. Refused building IDs are retained in the runner's expert queue.
The unweighted baseline uses the same votes and thresholds, with every weight set to one.

Gold decisions update weights only for later tiles. Simulated voter profiles persist
through a run, while weights reset to one for each independent mission run. Work-tile
simulation uses a private 50/50 latent truth and never updates weights from it.
The gold pool includes inferred intact examples; synthetic benchmark accuracy is
not evidence of real-world mapping accuracy.

`reports/bench.json`, `reports/latest.json`, and `reports/bench.md` include
per-seed results, pooled metrics, difficulty breakdowns, the ten-viewer learning
curve, and denominator definitions. The benchmark fixes its assumptions before
scoring: 65% easy, 25% shared hard tiles that reduce non-troll accuracy halfway
toward chance, and 10% misleading tiles that flip honest-voter accuracy. Raids
activate on 25% of tiles, and troll slots are split with one third always voting
opposite truth and the rest joining synchronized destroyed raids. The single-viewer
baseline reports mean, median, and 10th–90th percentile accuracy across honest
voters' raw non-unsure votes. Accuracy is over validated gold; false-destroyed and
false-intact rates use all intact and all destroyed gold respectively. Refusal and
coverage use all gold. Votes per tile includes final unsure votes.

Benchmark runs append their complete event history to the ignored `data/bench-ledger.jsonl`.
Live missions use `data/ledger.jsonl`; existing live history is never migrated automatically.
Keep its `.head` sidecar with the file: record checksums detect final-line edits and
the saved head detects truncation. This is a single-process writer; an interrupted
append/head update recovers only when its `.head.tmp` exactly matches the verified
file. Windows head renames retry ten times, then fall back to a direct head write;
all other integrity mismatches fail hard.
`npm run verify` checks both ledgers, replays accepted votes and gold weight updates,
and compares the bench ledger?s recomputed metrics with `reports/latest.json`.

## Limits

The earlier 25 m imagery warning was based on incorrectly positioned crops, not a
valid registration measurement. Crops now materialize the full 3-by-3 tile mosaic
before extracting a 384-by-384 window centred on the building. All 190 crops were
rebuilt successfully (0 failures); the source tile cache was retained. Integer
pixel extraction centres the target to within half a pixel on each axis.

On the **40 intact gold tiles**, the estimated pre/post displacement magnitude has
**median 1.72 m**, interquartile range **1.36-2.62 m**, 10th-90th percentiles
**1.02-7.13 m**, and range **0.82-13.49 m**. These are per-crop magnitudes, not the
magnitude of an averaged displacement vector. The overlay rounds the median up
to the next 5 m and says **"Typical pre/post offset: about 5 m"**. This is a typical
value, not an upper bound. No registration correction is applied to displayed images.

Method: read the corrected pre/post JPEGs as grayscale float32; apply OpenCV's
384-by-384 Hann window and `phaseCorrelate` (normalized cross-power spectrum,
5-by-5 peak centroid for subpixel displacement). Convert each displacement to
metres with `156543.03392 * cos(latitude) / 2**19`. All 40 pairs are included,
without filtering, search restrictions, mean subtraction, or manual alignment.
Percentiles use NumPy's linear interpolation. Median correlation response is
0.143; **9/40 responses are below 0.1**, indicating ambiguous peaks. Appearance,
shadows, vegetation, terrain and changes between acquisition dates can confound
phase correlation. This is an image translation estimate, not surveyed geometric
accuracy; nearby overlapping crops are not independent samples. Intact gold is
inferred from OSM buildings more than 40 m from a Copernicus damage point.

Reproduce with `python scripts/measure-offset.py` (OpenCV and NumPy, already
available on the analysis machine). The script first checks a seeded known
translation. Per-pair pixel/metre shifts, responses, image hashes, package versions
and summary statistics are in `reports/overlay/offset-measurement.json`.
Run `npm exec tsx -- scripts/crop-sheet.ts` after warming to regenerate
`reports/overlay/crop-sheet.png`: the first 12 gold entries in mission-file order,
pre | post, with a 12 m ring. Visual review shows most pre rings overlap roofs or
structures, but a few remain vegetation or ambiguous features; centring the crop
does not itself validate the source point or a damage label.

The bundled overlay fixture photos now use the corrected `cems-0052` crop:
houses before, flood sediment after. Fixture decisions remain illustrative.

## Cached AI debaters

`npm run debates:warm` uses `OPENAI_API_KEY` and `OPENAI_MODEL` (default
`gpt-6-luna`, verified with this key on 2026-11-01). It makes one structured Responses
API request for both sides per building, with an 8-second AbortController timeout
per attempt, one retry, and at most four requests in parallel. The only model inputs
are the corrected pre/post JPEGs and a fixed centre-ring instruction. No building
ID, geographic coordinates, gold membership or expert grade is included.
The model is instructed to argue both sides honestly and may concede a weak side.
Claims are Zod-validated, limited to 22 words, and reference visible evidence;
after-photo boxes are clamped in 384-pixel crop coordinates.

The warmup stores model name, timestamp, prompt version, both crop SHA-256 hashes,
claims, pixel boxes, model_label and confidence in `data/cache/debate/`. Matching
entries are skipped. All 190 entries were warmed with zero final failures. The live
runner reads only this cache and rejects missing, invalid or stale entries; it never
calls OpenAI and does not require an API key. A missing debate restores the explainer.
Virtual crowd benchmarks do not consult the debate cache.

During voting, the public projection contains claims and normalized boxes only.
After `consensus.decide()`, `lastResult.ai` reveals the baseline label and whether it
matched a validated chat label (false for a refusal). The tile_decided ledger event
records model_label and ai_model as metadata, never as votes or scoring inputs.
Tests replay identical votes with and without debate data and compare decisions and
weights. The after-image boxes use A/S tags and remain clipped to the after half of
the wipe. The result plate adds the muted AI-alone line only after a decision.

`npm run debates:score` checks cache hashes and writes `reports/ai-alone.json`, then
adds a real-measurement section to `reports/bench.md`. `npm run bench` preserves that
section. The measured line is: **AI alone: 73.8% on 80 hidden checks (destroyed 100.0%,
intact 47.5%).** Model: gpt-6-luna; API date: 2026-11-01. This is 59/80, including
40/40 destroyed and 19/40 inferred intact, not simulated accuracy.

Binary agreement with experts on the 110 work tiles is not measurable: their grades
are Damaged or Possibly damaged, not destroyed/intact. The report instead retains
those expert grades and cross-tabulates AI labels: Damaged 25 destroyed / 7 intact;
Possibly damaged 46 destroyed / 32 intact. These are counts, not accuracy or an
invented binary agreement score. The small geographically clustered gold set and
inferred intact labels limit generalization; the model's high destroyed sensitivity
comes with many false-destroyed classifications on intact gold.

`?fixture=debate` uses the real cached cems-0052 arguments. Its source fixture stores
only public claims/boxes; the two result fixtures demonstrate the post-decision
AI-alone line. Headless Edge checks at 1920x1080 confirm two lines per claim at 28 px,
with no overlap into the tally. Screenshots are in `reports/overlay/phase5-*.png`.

Model and API references: [OpenAI model catalog](https://developers.openai.com/api/docs/models)
and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).


## Recording and mission exports

`npm run demo:video` plays six fixed tiles with seed 20, 8 s voting and 3 s result pauses, finishing in about 66 s. Leave the completion screen up to record about 75 s. The overlay continues to say Simulated crowd. The searched plan and reasons are in `scripts/video-plan.json`; this intentionally selected run is not a benchmark. Its events append to `data/video-ledger.jsonl` only. At completion, ledger replay generates `reports/nepal-flood-2026-{validated,refused}.geojson`, the mission report and its provenance manifest. `npm run report` regenerates them; `npm run verify` compares the outputs and checks all three ledgers. The six-tile video exports are demonstration inputs for expert review, not operational mapping results.

### Limits: live simulation assumption

For live simulation only, a Damaged work tile uses destroyed as the crowd's private truth at hard difficulty. A Possibly damaged work tile keeps a shared 50/50 truth at hard difficulty. These are assumptions for generating simulated votes, not binary expert grades. They never supply ledger labels or change consensus.decide(), and they do not enter published benchmark metrics. The benchmark remains gold-only and unchanged. Misleading tiles achieve 0% weighted accuracy in the ten-viewer benchmark; they comprise 10% of the difficulty mix, not 0% of tiles. Shared errors remain a limitation.

Twitch CLI refresh uses `twitch token -R <refresh token>` (`--refresh`); lowercase `-r` revokes a token. Never paste token values into logs or reports.


<!-- MISSION-NUMBERS:START -->
| Measurement | Result | Source |
|---|---|---|
| One viewer alone (simulated, Herfort 2019 rates) | 75.9% | Honest-voter raw accuracy; [benchmark](reports/bench.md), bench ledger replay |
| Ten viewers with three trolls, weighted by hidden checks (simulated) | 89.2% on 81.3% validated | [Benchmark](reports/bench.md), bench ledger replay |
| AI alone (real API measurement) | 73.8% (destroyed 100.0%, intact 47.5%) | gpt-6-luna; 2026-11-01; [cached predictions](reports/ai-alone.json) |
| AI false alarms on intact buildings | 52.5% | 21/40 intact hidden checks; same API measurement |
<!-- MISSION-NUMBERS:END -->
