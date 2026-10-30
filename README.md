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
- `npm run dev:bot` — connect to Twitch, send one startup announcement, and log parsed votes.
- `npm test` — run Vitest.
- `npm run lint` — run ESLint and TypeScript checks.
- `npm run verify` — verify published report data against the ledger.

Copy `.env.example` to `.env` and fill in credentials before connecting Twitch or OpenAI.

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
to the future vote ingest layer. Press Ctrl+C to stop the bot.
