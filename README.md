# Many Eyes

## What this is
Many Eyes turns Twitch chat into a verified disaster-mapping crew.
The overlay shows a building before and after a disaster.
Two AI debaters discuss whether the building survived.
Chat votes `1` for destroyed, `2` for intact, or `3` for unsure.
A consensus engine validates supported labels and refuses uncertain ones.
Hidden gold tiles measure chat accuracy in real time.
Votes are recorded in an append-only, hash-chained ledger.
Results can be exported as GeoJSON for humanitarian mappers.
The OBS browser-source overlay is designed for 1920×1080.
Imagery attribution is shown directly on the overlay.

## Run commands

- `npm install` — install workspace dependencies.
- `npm run dev` — run the server and overlay in watch mode.
- `npm run dev:server` — run the HTTP server and one real-time mission, with SSE at `/api/stream`.
- `npm run dev:bot` — connect to Twitch, send one startup announcement, and log parsed votes.
- `npm test` — run Vitest.
- `npm run lint` — run ESLint and TypeScript checks.
- `npm run verify` — verify published report data against the ledger.
- `npm run mission -- nepal-flood-2026 sim` — run 15-second voting windows and 5-second pauses.
- `npm run mission -- nepal-flood-2026 twitch` — use Twitch votes and announce one result per tile.
- `npm run bench` — simulate 80 gold tiles at 1, 5, 10, 15, and 25 voters over 20 seeds, with shared hard tiles and troll raids.

Copy `.env.example` to `.env` and fill in credentials before connecting Twitch or OpenAI.

The server starts with an empty `.env`: `MANY_EYES_SOURCE` defaults to `sim` and
`MANY_EYES_SEED` to `7`. Set the source to `twitch` to require and use Twitch
credentials. The server owns one mission runner, with 15-second voting windows
and 5-second result pauses. Closing the server stops the runner and its streams.

`GET /api/stream` sends an unnamed SSE `data:` event containing the latest public
state immediately, then on every state change. It sends a `: ping` comment every
15 seconds. EventSource reconnects receive a fresh snapshot. `serverNow` is epoch
milliseconds for clock correction. The optional `debate` field is reserved for Phase 5.
`live.voters` counts non-unsure voters and `live.unsure` counts unsure voters; ties
have no leading label. `stats.goldChecked` counts decided gold tiles and
`stats.goldCorrect` counts those validated with the correct label. `remaining`
includes the open tile. Detailed gold results appear after deciding and are
cleared from public state when the next voting window opens.

Tile responses include `zoom`, `sizePx`, and `lat`. Crops use 256-pixel XYZ tiles;
metres per crop pixel is `156543.03392 * cos(lat * Math.PI / 180) / 2 ** zoom`.

Use Node 22 or newer. The bot reads `.env` from the repository root and requires the
Twitch client ID, user token, refresh token, bot user ID, and broadcaster user ID.
The user token must belong to the configured client and bot, with `user:read:chat`
and `user:write:chat` scopes. The bot uses outbound connections; it does not bind `PORT`.

Set optional `TWITCH_CLIENT_SECRET` to refresh an invalid token or one with less
than ten minutes remaining at startup. Refreshed tokens replace their entries in
`.env`. Without the secret, run `twitch token -r <refresh token>` when prompted and
update `.env`. Credentials and Twitch response bodies are never logged.

EventSub deduplicates the most recent 10,000 notification IDs. A server-directed
reconnect transfers the existing subscription; a lost connection creates a new
session and subscription. Twitch cannot replay chat missed during a disconnect.
The bot currently logs votes only; per-user replacement and tile closure belong
to the mission runner. Press Ctrl+C to stop the bot or runner.

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

Benchmark runs append their complete event history to the ignored `data/ledger.jsonl`.
Keep its `.head` sidecar with the file: record checksums detect final-line edits and
the saved head detects truncation. This is a single-process writer; an interrupted
append/head update fails verification rather than silently repairing history.
`npm run verify` checks the chain, replays accepted votes and gold weight updates,
and compares the recomputed metrics with `reports/latest.json`.
