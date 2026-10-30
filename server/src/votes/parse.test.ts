import { expect, it } from "vitest";
import { parseVote } from "./parse.js";

it.each([
  ["1", "destroyed"], ["2", "intact"], ["3", "unsure"],
  ["!1", "destroyed"], ["!2", "intact"], ["!3", "unsure"],
  ["destroyed", "destroyed"], ["intact", "intact"], ["unsure", "unsure"],
  [" DESTROYED ", "destroyed"], ["\tIntact\n", "intact"], ["UNSURE", "unsure"],
  ["", null], ["hello", null], ["12", null], ["!4", null],
  ["1 2", null], ["destroyed!", null], ["I vote 1", null], ["! 2", null],
])("parses %j as %j", (input, expected) => expect(parseVote(input!)).toBe(expected));
