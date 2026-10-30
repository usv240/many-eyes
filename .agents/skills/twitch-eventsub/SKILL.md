# Twitch EventSub for Many Eyes

Connect to `wss://eventsub.wss.twitch.tv/ws` using the user's access token. After `session_welcome`, subscribe to `channel.chat.message` within 10 seconds using the session ID. Answer `session_keepalive` without reconnecting. For `session_reconnect`, connect to the supplied URL exactly as received and keep the old socket active until the replacement sends `session_welcome`. Handle close codes 4000–4007 according to Twitch's EventSub recovery guidance. Deduplicate notifications by `metadata.message_id` before processing votes so retries cannot count twice.
