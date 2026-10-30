import { readConfig, requestJson, type TwitchConfig } from "./auth.js";

export function createChatSender(config: TwitchConfig, fetcher = fetch) {
  let queue: Promise<unknown> = Promise.resolve();
  // Capacity one; the consumed token replenishes after one second, without bursts.
  let nextTokenAt = 0;
  return (text: string): Promise<void> => {
    const operation = queue.then(async () => {
      if (!text.trim() || text.length > 500) throw new Error("Chat message must contain 1–500 characters.");
      const delay = Math.max(0, nextTokenAt - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      nextTokenAt = Date.now() + 1000;
      const result = await requestJson("https://api.twitch.tv/helix/chat/messages", {
        method: "POST", headers: { Authorization: `Bearer ${config.userToken}`,
          "Client-Id": config.clientId, "Content-Type": "application/json" },
        body: JSON.stringify({ broadcaster_id: config.broadcasterUserId, sender_id: config.botUserId, message: text }),
      }, fetcher) as { data?: { is_sent?: boolean }[] };
      if (result?.data?.[0]?.is_sent !== true) throw new Error("Twitch did not deliver the chat message.");
    });
    queue = operation.catch(() => {});
    return operation;
  };
}

let defaultSender: ReturnType<typeof createChatSender> | undefined;
export function sendChat(text: string): Promise<void> {
  defaultSender ??= createChatSender(readConfig());
  return defaultSender(text);
}
