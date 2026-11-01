/** Probe before constructing a live runner, so a port clash cannot append mission events. */
export async function assertPortUnused(port: number, fetcher = fetch) {
  try {
    await fetcher("http://127.0.0.1:" + port + "/api/missions", { signal: AbortSignal.timeout(2000) });
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") return;
    throw new Error("Cannot confirm that PORT " + port + " is free; another program may be listening or unresponsive.");
  }
  throw new Error("PORT " + port + " already answers /api/missions. Stop that program or select a different PORT.");
}
export async function assertOwnServer(port: number, instanceId: string, fetcher = fetch) {
  const response = await fetcher("http://127.0.0.1:" + port + "/api/missions", { signal: AbortSignal.timeout(5000) });
  if (!response.ok || response.headers.get("x-many-eyes-instance") !== instanceId)
    throw new Error("PORT " + port + " is answering from another program, not this Many Eyes server.");
}
