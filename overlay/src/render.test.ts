import { expect, it } from "vitest";
import { createRenderer } from "./render.js";
import { view } from "./view.js";
import { fixture, imagery } from "./test-fixtures.js";

it("removes the hidden attribute from the SVG target after imagery loads", () => {
  const attributes = new Map<string, Set<string>>();
  const root = { querySelector(selector: string) {
    const attrs = attributes.get(selector) ?? new Set(["hidden"]); attributes.set(selector, attrs);
    return { setAttribute: (key: string) => attrs.add(key), removeAttribute: (key: string) => attrs.delete(key),
      style: { setProperty() {} } };
  } } as unknown as ParentNode;
  const render = createRenderer(root);
  render(view(fixture(), { imagery, imageryStatus: "ready" }));
  expect(attributes.get('[data-node="target"]')!.has("hidden")).toBe(false);
});

it("makes no DOM writes for an unchanged model and patches only changed values", () => {
  const writes: string[] = [];
  const elements = new Map<string, object>();
  const root = { querySelector(selector: string) {
    if (!elements.has(selector)) {
      const node = { setAttribute: (key: string) => writes.push(selector + key), removeAttribute: (key: string) => writes.push(selector + key),
        style: { setProperty: (key: string) => writes.push(selector + key) } };
      for (const key of ["textContent", "hidden"]) Object.defineProperty(node, key, { set: () => writes.push(selector + key) });
      elements.set(selector, node);
    }
    return elements.get(selector);
  } } as unknown as ParentNode;
  const render = createRenderer(root); const state = fixture();
  render(view(state)); const firstWrites = writes.length;
  render(view(state)); expect(writes).toHaveLength(firstWrites);
  state.live.agreement = 0.75; render(view(state));
  expect(writes.slice(firstWrites)).toEqual(['[data-node="agreement"]textContent', '[data-node="destroyedFill"]transform', '[data-node="intactFill"]transform']);
});
