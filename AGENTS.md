# Many Eyes — agent instructions

Many Eyes turns a Twitch chat into a verified disaster-mapping crew. The overlay shows a building before/after a disaster, two AI debaters argue whether it survived, chat votes `1` / `2` / `3`, a consensus engine validates or refuses, hidden gold tiles measure chat accuracy live, and results export as GeoJSON for humanitarian mappers.

Built for the Codex x TwitchCon Hackathon (deadline Nov 2, 2026, 2:00 PM PT). Three days of build time. Prefer the simplest thing that works and is testable.

## Stack (do not change without asking)
- Node 22 or newer (dev machine runs 24; `engines` must be `">=22"`), TypeScript (strict), ESM. Built-in `WebSocket` (no `ws` package).
- `npm` only. Ask before adding any dependency beyond: `fastify`, `better-sqlite3`, `zod`, `openai`, `vite`, `vitest`, `tsx`.
- Server: Fastify. State: SQLite via `better-sqlite3`. Overlay: Vite + vanilla TypeScript (no framework).
- Monorepo layout:
  - `server/` — Twitch EventSub client, vote ingest, consensus engine, ledger, tile service, debate agents, exports, HTTP + WebSocket API
  - `overlay/` — OBS browser-source page (1920×1080), connects to server WebSocket
  - `sim/` — simulated crowd and replay tooling
  - `data/` — missions, gold tiles, cached imagery (gitignored except small fixtures)
  - `reports/` — generated Mission Reports (Markdown + JSON)
  - `.agents/skills/` — Codex skills for this repo

## Commands
- `npm run dev` — server + overlay with hot reload
- `npm test` — vitest, must pass before every commit
- `npm run lint` — eslint + tsc --noEmit
- `npm run verify` — recompute every published number from `data/ledger.jsonl` and diff against `reports/latest.json`

## Rules
- Never commit secrets. All config via `.env` (see `.env.example`). Fail fast at startup if a required variable is missing.
- Twitch:
  - Read chat via EventSub WebSocket (`wss://eventsub.wss.twitch.tv/ws`) with a **user access token**; subscribe to `channel.chat.message` within 10 s of `session_welcome`; handle `session_keepalive`, `session_reconnect` (connect to the given URL unmodified, keep old socket until new welcome), and close codes 4000–4007; dedupe on `metadata.message_id`.
  - Send chat via `POST https://api.twitch.tv/helix/chat/messages`. At most 1 bot message per tile result; never more than 1 message/sec.
  - Validate the token at startup via `GET https://id.twitch.tv/oauth2/validate` with `Authorization: OAuth <token>`.
- Votes are `1` (destroyed), `2` (intact), `3` (unsure). Also accept `!1 !2 !3`, `destroyed`, `intact`, `unsure`. First vote per user per tile counts; later votes replace it until the tile closes.
- Consensus: per-user weight starts at 1.0 and is updated only from gold tiles. A label is **validated** when weighted agreement ≥ 0.66 and at least 3 distinct voters; otherwise the tile is **refused** and queued. Never let the AI debaters' output influence the label.
- Ledger: append-only `data/ledger.jsonl`, one JSON object per event, each line carrying `prev_hash` (sha256 of the previous line). `npm run verify` must detect any edit.
- Imagery attribution must be rendered on the overlay: "Imagery: Vantor / Planet via OpenAerialMap, CC BY-NC 4.0".
- Dignity: no language like "wrecked", "KO", "points for destruction". Use "destroyed / intact / unsure", "validated", "refused".
- Every module gets a small vitest file. The consensus engine and ledger need property-style tests (random vote streams, troll injection).
- Keep files under ~300 lines. Prefer pure functions for anything scored.

## Code Review Rules
- Flag any network call without a timeout.
- Flag any place a vote could be counted twice (missing `message_id` dedupe or missing per-user replacement).
- Flag any path where a label is written to the ledger without passing through `consensus.decide()`.
- Flag secrets or tokens in source, fixtures, or logs.
