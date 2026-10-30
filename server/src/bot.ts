import { pathToFileURL } from "node:url";
import { readConfig } from "./twitch/auth.js";
import { EventSubClient } from "./twitch/eventsub.js";
import { createChatSender } from "./twitch/send.js";
import { parseVote } from "./votes/parse.js";

export function voteLog(userLogin: string, text: string): string | null {
  const vote = parseVote(text);
  return vote ? `${userLogin.replace(/[^a-zA-Z0-9_]/g, "")}: ${vote}` : null;
}

async function main() {
  const config = readConfig();
  const client = new EventSubClient(config);
  const sendChat = createChatSender(config);
  client.on("chatMessage", ({ userLogin, text }) => {
    const line = voteLog(userLogin, text);
    if (line) console.log(line);
  });
  client.on("status", (message) => console.log(message));
  client.on("fault", (error) => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => client.stop());
  try {
    await client.start();
    await sendChat("Many Eyes bot online");
    console.log("Many Eyes bot listening for Twitch chat votes.");
  } catch (error) {
    client.stop();
    console.error(error instanceof Error ? error.message : "Bot startup failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
