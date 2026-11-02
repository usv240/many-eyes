import { expect, it } from "vitest";
import { Crew, displayName } from "./crew.js";

const logins = new Map([["123", "ana_maps"]]);

it("names real chat by login and simulated voters by number", () => {
  expect(displayName("123", logins)).toEqual({ name: "ana_maps", live: true });
  expect(displayName("sim_0009", logins)).toEqual({ name: "viewer 9", live: false });
});

it("credits matches on hidden checks, skips unsure, and returns only real names that matched", () => {
  const crew = new Crew();
  const matched = crew.credit([
    { userId: "123", label: "destroyed" }, { userId: "sim_0001", label: "destroyed" },
    { userId: "sim_0002", label: "intact" }, { userId: "sim_0003", label: "unsure" },
  ], "destroyed", logins);
  expect(matched).toEqual(["ana_maps"]);
  crew.credit([{ userId: "sim_0001", label: "intact" }, { userId: "123", label: "intact" }], "intact", logins);
  expect(crew.top()).toEqual([
    { name: "ana_maps", matched: 2, checked: 2, live: true },
    { name: "viewer 1", matched: 2, checked: 2, live: false },
  ]);
});

it("ranks by matches, then fewest misses, and stays bounded", () => {
  const crew = new Crew(2);
  crew.credit([{ userId: "sim_0001", label: "intact" }, { userId: "sim_0002", label: "intact" }, { userId: "sim_0003", label: "intact" }], "intact", logins);
  crew.credit([{ userId: "sim_0001", label: "destroyed" }, { userId: "sim_0002", label: "intact" }], "intact", logins);
  expect(crew.top().map((entry) => entry.name)).toEqual(["viewer 2", "viewer 1"]);
});
