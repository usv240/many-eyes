import { readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";

export interface TwitchConfig {
  clientId: string; userToken: string; refreshToken: string;
  botUserId: string; broadcasterUserId: string; clientSecret?: string;
}

export function readConfig(env = process.env): TwitchConfig {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${key}`);
    return value;
  };
  return {
    clientId: required("TWITCH_CLIENT_ID"), userToken: required("TWITCH_USER_TOKEN"),
    refreshToken: required("TWITCH_REFRESH_TOKEN"), botUserId: required("TWITCH_BOT_USER_ID"),
    broadcasterUserId: required("TWITCH_BROADCASTER_USER_ID"),
    clientSecret: env.TWITCH_CLIENT_SECRET?.trim() || undefined,
  };
}

/** How long to wait before the one retry Helix allows: 429 waits for Ratelimit-Reset (at most 5 s), 503 waits 1 s. */
export function retryDelay(response: Response, now = Date.now()): number | undefined {
  if (response.status === 503) return 1000;
  if (response.status !== 429) return undefined;
  const reset = Number(response.headers.get("Ratelimit-Reset")) * 1000;
  return Number.isFinite(reset) && reset > 0 ? Math.min(Math.max(reset - now, 0), 5000) : 1000;
}

// Never include response bodies, credentials, or underlying network errors in errors.
export async function requestJson(url: string, init: RequestInit, fetcher = fetch,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<unknown> {
  try {
    let response = await fetcher(url, { ...init, signal: AbortSignal.timeout(5000) });
    const wait = retryDelay(response);
    if (wait !== undefined) {
      await sleep(wait);
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(5000) });
    }
    if (!response.ok) throw new HttpError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Error("Twitch request failed or exceeded its 5 second timeout.");
  }
}
export class HttpError extends Error {
  constructor(public readonly status: number) { super(`Twitch request failed (HTTP ${status}).`); }
}

export function rewriteTokens(source: string, access: string, refresh: string): string {
  for (const [key, value] of [["TWITCH_USER_TOKEN", access], ["TWITCH_REFRESH_TOKEN", refresh]]) {
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    let found = false;
    source = source.replace(pattern, () => { found = true; return `${key}=${JSON.stringify(value)}`; });
    if (!found) source += `${source.endsWith("\n") ? "" : "\n"}${key}=${JSON.stringify(value)}\n`;
  }
  return source;
}

export async function persistTokens(access: string, refresh: string, path = ".env") {
  const temporary = `${path}.refresh.tmp`;
  try {
    const contents = rewriteTokens(await readFile(path, "utf8"), access, refresh);
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, path);
  } catch { throw new Error("Could not persist refreshed Twitch credentials to .env."); }
}

const validationSchema = z.object({ client_id: z.string(), user_id: z.string(), expires_in: z.number() });
const tokensSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) });

export async function validateToken(config: TwitchConfig, fetcher = fetch,
  save: (access: string, refresh: string) => Promise<void> = persistTokens): Promise<void> {
  const validate = async () => {
    const raw = await requestJson("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${config.userToken}` },
    }, fetcher);
    const result = validationSchema.safeParse(raw);
    if (!result.success) throw new Error("Invalid Twitch token validation response.");
    if (result.data.client_id !== config.clientId || result.data.user_id !== config.botUserId)
      throw new Error("Twitch token must belong to TWITCH_CLIENT_ID and TWITCH_BOT_USER_ID.");
    return result.data.expires_in;
  };
  let expires = 0;
  try { expires = await validate(); }
  catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error; }
  if (expires >= 600) return;
  if (!config.clientSecret)
    throw new Error("Twitch token needs refreshing. Run `twitch token -R <refresh token>` and update .env, or set TWITCH_CLIENT_SECRET.");
  const raw = await requestJson("https://id.twitch.tv/oauth2/token", {
    method: "POST", body: new URLSearchParams({ grant_type: "refresh_token",
      client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken }),
  }, fetcher);
  const tokens = tokensSchema.safeParse(raw);
  if (!tokens.success) throw new Error("Invalid Twitch token refresh response.");
  await save(tokens.data.access_token, tokens.data.refresh_token);
  config.userToken = tokens.data.access_token;
  config.refreshToken = tokens.data.refresh_token;
  if (await validate() < 600) throw new Error("Refreshed Twitch token expires too soon.");
}
