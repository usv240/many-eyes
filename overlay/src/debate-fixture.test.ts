import { expect, it } from "vitest";
import { debateFixture } from "./debate-fixture.js";
import { fixtureSnapshot } from "./fixtures.js";
import { view } from "./view.js";

it("renders real cached public claims with short after-image tags, but no voting baseline", () => {
  const snapshot = fixtureSnapshot("debate", 10000);
  const model = view(snapshot.state, { ...snapshot, now: 10000 });
  expect(model.hidden.debate).toBe(false); expect(model.hidden.explainer).toBe(true);
  expect(model.text.advocateClaim).toBe(debateFixture.advocate.claim);
  expect(model.text.advocateBoxLabel).toBe("A"); expect(model.text.skepticBoxLabel).toBe("S");
  expect(JSON.stringify(snapshot)).not.toMatch(/model_label|confidence|agreedWithChat/);
  for (const argument of Object.values(debateFixture)) expect(argument.claim.split(/\s+/).length).toBeLessThanOrEqual(22);
  expect(model.text.aiCopy).toBe("");
  const result = fixtureSnapshot("validated", 10000);
  expect(view(result.state, result).text.aiCopy).toBe("AI alone said: destroyed.");
  snapshot.state!.debate = undefined;
  expect(view(snapshot.state).hidden.explainer).toBe(false);
});
