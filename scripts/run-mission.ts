import { MissionRunner } from "../server/src/runner/mission-runner.js";

const missionId = process.argv[2] ?? "nepal-flood-2026";
const source = process.argv[3] ?? "sim";
if (source !== "sim" && source !== "twitch") throw new Error("Source must be sim or twitch.");
const runner = new MissionRunner({ missionId, source });
runner.on("state", (state) => {
  if (state.phase === "decided") console.log("Tile " + state.tile?.number + ": " + state.decision?.status);
});
runner.on("warning", (message) => console.error(message));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => runner.stop());
await runner.run();
