import { expect, it } from "vitest";
import { decideBatch, LIMITS, votesFromCsv } from "./decide.js";
it("rejects oversized CSV and vote fields before building sessions", () => {
  expect(() => votesFromCsv("x".repeat(LIMITS.csvChars + 1))).toThrow("20 MB");
  expect(() => votesFromCsv("tile_id,user_id,vote\n" + "a,b,1\n".repeat(1001))).toThrow("votes-per-tile");
  expect(() => decideBatch({ tiles: [{ id: "a", votes: [{ user: "b", vote: "1".repeat(33) }] }] })).toThrow();
});
it("rejects conflicting CSV truth and coordinates instead of silently changing gold weights", () => {
  expect(() => votesFromCsv("tile_id,user_id,vote,truth\na,b,1,intact\na,c,1,destroyed")).toThrow("conflicting truth");
  expect(() => votesFromCsv("tile_id,user_id,vote,lon,lat\na,b,1,85,28\na,c,1,86,28")).toThrow("conflicting coordinates");
  expect(() => votesFromCsv("tile_id,user_id,vote,lon,lat\na,b,1,wrong,28")).toThrow("numeric lon and lat");
});

it("preserves quoted CSV identifiers without shifting votes into another column", () => {
  const request = votesFromCsv('tile_id,user_id,vote\n"house,a",1,2\n"house,""b""",2,1');
  expect(request.tiles).toEqual([
    { id: "house,a", votes: [{ user: "1", vote: "2" }] },
    { id: 'house,"b"', votes: [{ user: "2", vote: "1" }] },
  ]);
  expect(() => votesFromCsv('tile_id,user_id,vote\n"broken,1,2')).toThrow("Unclosed");
  expect(() => votesFromCsv('tile_id,user_id,vote,vote\na,b,1,2')).toThrow("unique");
});
