import { HttpError, requestJson, type TwitchConfig } from "./auth.js";

/**
 * Twitch stream markers turn the broadcast's saved video into an index of decided buildings: each
 * validated or refused tile gets a marker, so a responder can jump straight to it later.
 * Needs the channel:manage:broadcast scope and a live stream; otherwise Twitch refuses and we stay quiet.
 */
export function createMarker(config: TwitchConfig, fetcher = fetch, warn: (text: string) => void = console.warn) {
  let disabled = false;
  return async (description: string): Promise<boolean> => {
    if (disabled) return false;
    try {
      await requestJson("https://api.twitch.tv/helix/streams/markers", {
        method: "POST", headers: { Authorization: `Bearer ${config.userToken}`, "Client-Id": config.clientId, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: config.broadcasterUserId, description: description.slice(0, 140) }),
      }, fetcher);
      return true;
    } catch (error) {
      // 401 or 403: the token lacks channel:manage:broadcast. Stop trying for this run and say so once.
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        disabled = true;
        warn("Stream markers are off: add the channel:manage:broadcast scope to the Twitch token to enable them.");
      }
      // 404 means the channel is not live right now; markers simply wait for the next decision.
      return false;
    }
  };
}
